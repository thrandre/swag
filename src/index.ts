import * as mkdirp from "mkdirp";
import { dirname, join, isAbsolute } from "path";

import { getSwaggerResponse } from "./api";
import { default as emitters, EmitterEntry } from "./emitters";
import { writeFile } from "./fsUtils";
import * as Swagger from "./parsers/swagger";
import {
  createModule,
  resolveModuleDependencies,
  getTypePool
} from "./processing";
import { CliFlags, Emitter } from "./types";
import {
  Hash,
  resolvePath} from "./utils";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function outputModules(basePath: string, modules: [string, string][]) {
  modules.forEach(([path, content]) => {
    const filename = join(basePath, path);
    mkdirp(join(basePath, dirname(path)), () => writeFile(filename, content));
  });
}

async function loop(
  emitter: { emitter: Emitter; meta: EmitterEntry },
  [name, config]: [string, ApiConfigSchema]
) {
  const res = await getSwaggerResponse(config.url);

  const operations = Swagger.getOperations(res);
  const schemas = Swagger.getSchemas(res);

  const typePool = getTypePool(
    (schemas as Swagger.EntityMetadata[]).concat(operations)
  );

  const modules = emitter.emitter.createModules(name, typePool, createModule);
  const emittedModules = modules
    .filter(([, module]) => module.emittable)
    .map<[string, string]>(([moduleName, module]) => [
      moduleName,
      emitter.emitter.emitModule(
        name,
        module,
        resolveModuleDependencies(module, modules.map(([_, mm]) => mm))
      )
    ]);
  return emittedModules;
}

async function start(config: ConfigSchema): Promise<void> {
  const emitter = getEmitter(
    Array.isArray(config.language) ? config.language[0] : config.language,
    config.language[1]
  );

  Object.keys(config.apis).forEach(async apiName => {
    const modules = await loop(emitter, [apiName, config.apis[apiName]]);

    outputModules(config.basePath || "", modules);
  });
}

function getEmitter(path: string, config?: any) {
  try {
    const emitter = (emitters as Hash<EmitterEntry>)[path];
    return {
      meta: emitter,
      emitter: require(resolvePath(
        (emitter && emitter.path) || path,
        emitter ? __dirname : process.cwd()
      ))(config)
    };
  } catch (err) {
    throw new Error(`Unable to resolve emitter "${path}": ${err}`);
  }
}

import * as fs from "fs";

interface ApiConfigSchema {
  url: string;
}

interface ConfigSchema {
  language: string | [string, any];
  basePath?: string;
  apis: { [key: string]: ApiConfigSchema };
}

async function readConfig(configPath: string) {
  return new Promise<ConfigSchema>((res, reject) => {
    fs.readFile(configPath, { encoding: "utf8" }, (err, data) => {
      if (err) {
        return reject(err);
      }

      return res(JSON.parse(data));
    });
  });
}

export async function run(flags: CliFlags) {
  if (!flags.config) {
    throw new Error(`Missing required parameter "config"`);
  }

  const config = await readConfig(
    isAbsolute(flags.config) ? flags.config : join(process.cwd(), flags.config)
  );

  config.basePath = join(process.cwd(), config.basePath || "./");

  start(config);
}
