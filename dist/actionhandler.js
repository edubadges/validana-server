"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["New"] = "new";
    TransactionStatus["ProcessingAccepted"] = "processing_accepted";
    TransactionStatus["ProcessingRejected"] = "processing_rejected";
    TransactionStatus["Invalid"] = "invalid";
    TransactionStatus["Accepted"] = "accepted";
    TransactionStatus["Rejected"] = "rejected";
})(TransactionStatus = exports.TransactionStatus || (exports.TransactionStatus = {}));
var UpdateReason;
(function (UpdateReason) {
    UpdateReason[UpdateReason["Id"] = 0] = "Id";
    UpdateReason[UpdateReason["Address"] = 1] = "Address";
    UpdateReason[UpdateReason["Global"] = 2] = "Global";
})(UpdateReason = exports.UpdateReason || (exports.UpdateReason = {}));
class ActionHandler {
    constructor(handler, client) {
        this.messageHandlers = new Map();
        this.updateHandlers = Array();
        this.terminationHandlers = Array();
        this.handler = handler;
        this.client = client;
    }
    terminate() {
        for (const handler of this.terminationHandlers) {
            handler.call(this);
        }
    }
    addTerminationHandler(handler) {
        this.terminationHandlers.push(handler);
    }
    receiveMessage(type, data) {
        const responseFunction = this.messageHandlers.get(type);
        if (responseFunction === undefined) {
            return Promise.reject(`Invalid type: ${type}`);
        }
        else {
            return responseFunction.call(this, data);
        }
    }
    addMessageHandler(type, handler) {
        this.messageHandlers.set(type, handler);
    }
    receiveUpdate(tx, reason) {
        for (const handler of this.updateHandlers) {
            handler.call(this, tx, reason);
        }
    }
    addUpdateHandler(handler) {
        this.updateHandlers.push(handler);
    }
}
exports.ActionHandler = ActionHandler;
//# sourceMappingURL=actionhandler.js.map