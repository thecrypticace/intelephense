/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const document_1 = require("./document");
const php7parser_1 = require("php7parser");
const parse_1 = require("./parse");
const symbol_1 = require("./symbol");
const lsp = require("vscode-languageserver-types");
var Intelephense;
(function (Intelephense) {
    var documentStore = new document_1.DocumentStore();
    var parseTreeStore = new parse_1.ParseTreeStore();
    var symbolStore = new symbol_1.SymbolStore();
    const namespacedSymbolMask = 2 /* Interface */ |
        1 /* Class */ |
        4 /* Trait */ |
        8 /* Constant */ |
        64 /* Function */;
    function openDocument(uri, text) {
        let doc = new document_1.TextDocument(uri, text);
        documentStore.add(doc);
        let parseTree = new parse_1.ParseTree(uri, php7parser_1.Parser.parse(text));
        parseTreeStore.add(parseTree);
        let symbolTable = symbol_1.SymbolTable.create(parseTree, doc);
        symbolStore.add(symbolTable);
    }
    Intelephense.openDocument = openDocument;
    function isDocumentOpen(uri) {
        return documentStore.find(uri) !== null;
    }
    Intelephense.isDocumentOpen = isDocumentOpen;
    function closeDocument(uri) {
        documentStore.remove(uri);
        parseTreeStore.remove(uri);
    }
    Intelephense.closeDocument = closeDocument;
    function editDocument(uri, changes) {
        let doc = documentStore.find(uri);
        if (!doc) {
            return;
        }
        let compareFn = (a, b) => {
            if (a.range.end.line > b.range.end.line) {
                return -1;
            }
            else if (a.range.end.line < b.range.end.line) {
                return 1;
            }
            else {
                return b.range.end.character - a.range.end.character;
            }
        };
        changes.sort(compareFn);
        let change;
        for (let n = 0, l = changes.length; n < l; ++n) {
            change = changes[n];
            doc.applyEdit(change.range.start, change.range.end, change.text);
        }
    }
    Intelephense.editDocument = editDocument;
    function documentSymbols(uri) {
        let symbolTable = symbolStore.getSymbolTable(uri);
        if (!symbolTable) {
            return [];
        }
        let symbols = symbolTable.symbols.map(toDocumentSymbolInformation);
        return symbols;
    }
    Intelephense.documentSymbols = documentSymbols;
    function toDocumentSymbolInformation(s) {
        let si = {
            kind: null,
            name: s.name,
            location: s.location,
            containerName: s.scope
        };
        //check for symbol scope to exclude class constants
        if ((s.kind & namespacedSymbolMask) && !s.scope) {
            let nsSeparatorPos = s.name.lastIndexOf('\\');
            if (nsSeparatorPos >= 0) {
                si.name = s.name.slice(nsSeparatorPos + 1);
                si.containerName = s.name.slice(0, nsSeparatorPos);
            }
        }
        switch (s.kind) {
            case 1 /* Class */:
                si.kind = lsp.SymbolKind.Class;
                break;
            case 8 /* Constant */:
                si.kind = lsp.SymbolKind.Constant;
                break;
            case 64 /* Function */:
                si.kind = lsp.SymbolKind.Function;
                break;
            case 2 /* Interface */:
                si.kind = lsp.SymbolKind.Interface;
                break;
            case 32 /* Method */:
                if (s.name === '__construct') {
                    s.kind = lsp.SymbolKind.Constructor;
                }
                else {
                    s.kind = lsp.SymbolKind.Method;
                }
                break;
            case 512 /* Namespace */:
                s.kind = lsp.SymbolKind.Namespace;
                break;
            case 16 /* Property */:
                s.kind = lsp.SymbolKind.Property;
                break;
            case 4 /* Trait */:
                s.kind = lsp.SymbolKind.Module;
                break;
            case 256 /* Variable */:
            case 128 /* Parameter */:
                s.kind = lsp.SymbolKind.Variable;
            default:
                throw new Error('Invalid Argument');
        }
        return si;
    }
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
