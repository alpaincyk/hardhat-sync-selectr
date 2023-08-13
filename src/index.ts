import axios from "axios";
import { task } from "hardhat/config";
import { HardhatPluginError } from "hardhat/plugins";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import { type HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "ethers";

async function action(args: any, hre: HardhatRuntimeEnvironment) {
  if (!args.noCompile) {
    await hre.run(TASK_COMPILE);
  }

  console.log(`[hardhat-sync-selectors] Starting...`);

  const allArtifactNames = await hre.artifacts.getAllFullyQualifiedNames();
  const fullComposite = await Promise.all(
    allArtifactNames.map((fullName) => hre.artifacts.readArtifact(fullName).then((e) => e.abi)),
  )
    .then((e) => e.flat())
    .then((e) => e.map((v) => [JSON.stringify(v), v] as const))
    .then((e) => [...new Map(e).values()]);

  const parsedComposite = fullComposite
    .filter((e) => ["function", "event", "error"].includes(e.type))
    .map((e) => {
      if (e.type === "error") {
        // errors are same as functions
        e.type = "function";
        e.outputs = [];
      }

      return e;
    });

  const functionSigs = parsedComposite
    .filter((e) => e.type === "function")
    .map((e) => {
      return ethers.FunctionFragment.from(e).format("sighash");
    });

  const eventSigs = parsedComposite
    .filter((e) => e.type === "event")
    .map((e) => {
      return ethers.EventFragment.from(e).format("sighash");
    });

  if (parsedComposite.length === 0) {
    throw new HardhatPluginError("hardhat-sync-selectors", "Nothing to sync!");
  }

  console.log(`[Ethereum Signature Database] Syncing...`);

  await axios
    .post("https://www.4byte.directory/api/v1/import-abi/", {
      contract_abi: JSON.stringify(parsedComposite),
    })
    .then(({ data }) => {
      console.log(
        `[Ethereum Signature Database] Synced ${data.num_processed} unique items from ${allArtifactNames.length} individual ABIs adding ${data.num_imported} new selectors to database with ${data.num_duplicates} duplicates and ${data.num_ignored} ignored items.`,
      );
    })
    .catch((error) => {
      throw new HardhatPluginError(
        "hardhat-sync-selectors",
        `[Ethereum Signature Database] Sync failed with code ${error.response.status}!`,
      );
    });

  console.log(`[OpenChain] Syncing...`);
  await axios
    .post("https://api.openchain.xyz/signature-database/v1/import", {
      function: functionSigs,
      event: eventSigs,
    })
    .then(({ data }) => {
      console.log(
        `[OpenChain] Synced ${Object.entries(data.result.function.imported ?? {}).length} functions, skipping ${
          Object.entries(data.result.function.duplicated ?? {}).length
        } duplicates and ${Object.entries(data.result.function.invalid ?? {}).length} invalid items.`,
      );
      console.log(
        `[OpenChain] Synced ${Object.entries(data.result.event.imported ?? {}).length} events, skipping ${
          Object.entries(data.result.event.duplicated ?? {}).length
        } duplicates and ${Object.entries(data.result.event.invalid ?? {}).length} invalid items.`,
      );
    })
    .catch((error) => {
      throw new HardhatPluginError(
        "hardhat-sync-selectors",
        `[OpenChain] Sync failed with code ${error.response.status}!`,
      );
    });

  console.log(`[hardhat-sync-selectors] Done!`);
}

task("sync-selectors", "Upload function selectors")
  .addFlag("noCompile", "Sync without compiling first")
  .setAction(action);

task("sync-signatures", "Upload function signatures")
  .addFlag("noCompile", "Sync without compiling first")
  .setAction(action);
