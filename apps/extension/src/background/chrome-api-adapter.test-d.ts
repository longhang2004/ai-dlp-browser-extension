import type { BackgroundChromeApi } from "./bootstrap.js";
import {
  createProductionChromeApiAdapter,
  type ProductionChromeApi,
} from "./chrome-api-adapter.js";

const productionChrome = chrome satisfies ProductionChromeApi;
const adapterSignature: (source: ProductionChromeApi) => BackgroundChromeApi =
  createProductionChromeApiAdapter;

adapterSignature(productionChrome);
