"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Cluster = require("cluster");
const OS = require("os");
const log_1 = require("./tools/log");
const resthandler_1 = require("./handlers/resthandler");
const wshandler_1 = require("./handlers/wshandler");
const database_1 = require("./database");
const config_1 = require("./config");
class ExtendedWorker extends Cluster.Worker {
}
function start() {
    process.on("uncaughtException", (error) => {
        if (error.stack === undefined) {
            error.stack = "";
        }
        if (config_1.Config.get().VSERVER_DBPASSWORD !== undefined) {
            error.message = error.message.replace(new RegExp(config_1.Config.get().VSERVER_DBPASSWORD, "g"), "");
            error.stack = error.stack.replace(new RegExp(config_1.Config.get().VSERVER_DBPASSWORD, "g"), "");
        }
        log_1.Log.fatal("uncaughtException", error).then(() => process.exit(2));
    });
    process.on("unhandledRejection", (reason, _) => {
        log_1.Log.fatal(`unhandledRejection: ${reason}`, new Error("unhandledRejection")).then(() => process.exit(2));
    });
    process.on("warning", (warning) => {
        log_1.Log.error("Process warning", warning);
    });
    try {
        config_1.Config.get();
    }
    catch (error) {
        log_1.Log.error(`${error.message} Exiting process.`);
        process.exit(1);
    }
    log_1.Log.options.tags.master = Cluster.isMaster.toString();
    log_1.Log.options.tags.nodejsVersion = process.versions.node;
    log_1.Log.Level = config_1.Config.get().VSERVER_LOGLEVEL;
    if (config_1.Config.get().VSERVER_SENTRYURL !== "") {
        try {
            log_1.Log.setReportErrors(config_1.Config.get().VSERVER_SENTRYURL);
        }
        catch (error) {
            log_1.Log.error(`Invalid sentry url: ${error.message} Exiting process.`);
            process.exit(1);
        }
    }
    let isShuttingDown = false;
    let isGraceful = true;
    if (Cluster.isMaster) {
        setupMaster();
    }
    else {
        setupWorker();
    }
    function setupMaster() {
        log_1.Log.info(`Master (pid: ${process.pid}) is running`);
        let workers = config_1.Config.get().VSERVER_WORKERS;
        if (workers <= 0) {
            workers = Math.max(1, OS.cpus().length + workers);
        }
        for (let i = 0; i < workers; i++) {
            createWorker();
        }
        Cluster.on("exit", (worker, code, _) => {
            if (code === 0) {
                log_1.Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) exited.`);
            }
            else {
                log_1.Log.info(`Worker ${worker.id} (pid: ${worker.process.pid}) died with code ${code}`);
                log_1.Log.error(`Worker died with code ${code}`);
            }
            if (!isShuttingDown) {
                if (code >= 50 && code < 60) {
                    setTimeout(createWorker, 30000);
                }
                else {
                    setTimeout(createWorker, 1000);
                }
            }
        });
        Cluster.on("message", (worker, message) => {
            if (message && message.type === "report" && message.memory) {
                worker.notNotifiedTimes = 0;
                if (message.memory > config_1.Config.get().VSERVER_MAXMEMORY) {
                    log_1.Log.warn(`Worker ${worker.id} using too much memory, restarting worker.`);
                    shutdownWorker(worker.id.toString(), true);
                }
            }
            else {
                log_1.Log.info(`Worker ${worker.id} send an unknown message.`);
                log_1.Log.error("Worker send an unknown message.");
            }
        });
        setInterval(() => {
            for (const id of Object.keys(Cluster.workers)) {
                const worker = Cluster.workers[id];
                if (worker !== undefined) {
                    if (worker.notNotifiedTimes === undefined) {
                        worker.notNotifiedTimes = 0;
                    }
                    else if (worker.notNotifiedTimes > 2) {
                        log_1.Log.info(`Worker ${id} failed to notify for 30 seconds, restarting worker.`);
                        log_1.Log.error("Worker failed to notify for 30 seconds, restarting worker.");
                        shutdownWorker(id, true);
                    }
                    else if (worker.notNotifiedTimes > 0) {
                        log_1.Log.warn(`Worker ${id} failed to notify.`);
                    }
                    worker.notNotifiedTimes++;
                }
            }
        }, 10000);
        process.on("SIGINT", () => shutdownMaster(false));
        process.on("SIGTERM", () => shutdownMaster(true));
    }
    function shutdownMaster(hardkill, code = 0) {
        if (!isShuttingDown) {
            log_1.Log.info("Master shutting down...");
            isShuttingDown = true;
            isGraceful = true;
            for (const id of Object.keys(Cluster.workers)) {
                shutdownWorker(id, hardkill);
            }
            setInterval(() => {
                if (Object.keys(Cluster.workers).length === 0) {
                    log_1.Log.info("Shutdown completed");
                    process.exit(code === 0 && !isGraceful ? 1 : code);
                }
            }, 500);
        }
    }
    function setupWorker() {
        Cluster.worker.on("error", (error) => {
            log_1.Log.error("Worker encountered an error", error);
            process.exit(1);
        });
        log_1.Log.info(`Worker ${Cluster.worker.id} (pid: ${process.pid}) started`);
        database_1.Database.get().init(Cluster.worker);
        const handlers = [];
        if (config_1.Config.get().VSERVER_WSPORT !== 0) {
            handlers.push(new wshandler_1.WebsocketHandler(Cluster.worker, config_1.Config.get().VSERVER_WSPORT));
        }
        if (config_1.Config.get().VSERVER_RESTPORT !== 0) {
            handlers.push(new resthandler_1.RestHandler(Cluster.worker, config_1.Config.get().VSERVER_RESTPORT));
        }
        Cluster.worker.on("message", (message) => {
            log_1.Log.info(`Worker ${process.pid} received message: ${message}`);
            if (message === "shutdown" && !isShuttingDown) {
                isShuttingDown = true;
                const promises = [];
                for (const handler of handlers) {
                    promises.push(handler.shutdownServer(true));
                }
                Promise.all(promises).then(() => process.exit(0)).catch();
            }
        });
        process.on("SIGTERM", () => {
            log_1.Log.info(`Worker ${process.pid} received SIGTERM`);
            if (!isShuttingDown) {
                isShuttingDown = true;
                const promises = [];
                for (const handler of handlers) {
                    promises.push(handler.shutdownServer(true));
                }
                Promise.all(promises).then(() => process.exit(0));
            }
        });
        process.on("SIGINT", () => {
            log_1.Log.info(`Worker ${process.pid} received SIGINT`);
            if (!isShuttingDown) {
                isShuttingDown = true;
                const promises = [];
                for (const handler of handlers) {
                    promises.push(handler.shutdownServer(true));
                }
                Promise.all(promises).then(() => process.exit(0));
            }
        });
    }
    function createWorker(timeout = 5000) {
        try {
            Cluster.fork(config_1.Config.get());
        }
        catch (error) {
            log_1.Log.warn("Failed to start worker", error);
            setTimeout(createWorker, timeout, Math.min(timeout * 1.5, 300000));
        }
    }
    function shutdownWorker(id, hardkill) {
        if (Cluster.workers[id] !== undefined) {
            Cluster.workers[id].send("shutdown", undefined, (error) => {
                if (error !== null && error.message !== "write EPIPE") {
                    log_1.Log.warn(`Worker ${id} shutdown failed`, error);
                }
            });
        }
        else {
            log_1.Log.info(`Trying to shutdown non-existing worker ${id}`);
            log_1.Log.error("Trying to shutdown non-existing worker");
        }
        if (hardkill) {
            setTimeout(() => {
                if (Cluster.workers[id] !== undefined) {
                    isGraceful = false;
                    log_1.Log.info(`Worker ${id} not shutting down.`);
                    log_1.Log.fatal("Hard killing worker, is there a contract with an infinite loop somewhere?");
                    process.kill(Cluster.workers[id].process.pid, "SIGKILL");
                }
            }, 10000);
        }
    }
}
exports.start = start;
//# sourceMappingURL=app.js.map