"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Path = require("path");
const config_1 = require("../config");
class Handler {
    constructor(worker, port) {
        this.apiVersions = new Map();
        this.worker = worker;
        this.port = port;
        const apis = JSON.parse(config_1.Config.get().VSERVER_API);
        for (const apiName of Object.keys(apis)) {
            const apiFile = require(Path.resolve(apis[apiName]));
            this.apiVersions.set(apiName, apiFile.default);
        }
    }
}
exports.Handler = Handler;
//# sourceMappingURL=handler.js.map