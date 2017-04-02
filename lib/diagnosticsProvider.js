/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const php7parser_1 = require("php7parser");
const lsp = require("vscode-languageserver-types");
class DiagnosticsProvider {
    diagnose(doc) {
        let diagnostics = [];
        let parseErrorVisitor = new ErrorVisitor();
        doc.traverse(parseErrorVisitor);
        let parseErrors = parseErrorVisitor.errors;
        for (let n = 0, l = parseErrors.length; n < l; ++n) {
            diagnostics.push(this._parseErrorToDiagnostic(parseErrors[n], doc));
        }
        return diagnostics;
    }
    _parseErrorToDiagnostic(err, doc) {
        return {
            range: doc.tokenRange(err.unexpected),
            severity: lsp.DiagnosticSeverity.Error,
            source: 'intelephense',
            message: `Unexpected ${php7parser_1.tokenTypeToString(err.unexpected.tokenType)}`,
        };
    }
}
exports.DiagnosticsProvider = DiagnosticsProvider;
class ErrorVisitor {
    constructor() {
        this._errors = [];
    }
    get errors() {
        return this._errors;
    }
    preOrder(node, spine) {
        if (parsedDocument_1.ParsedDocument.isPhrase(node) && node.errors) {
            Array.prototype.push.apply(this._errors, node.errors);
        }
        return true;
    }
}
