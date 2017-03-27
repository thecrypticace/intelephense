/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const document_1 = require("./document");
const php7parser_1 = require("php7parser");
const parse_1 = require("./parse");
const symbol_1 = require("./symbol");
const documentSymbols_1 = require("./documentSymbols");
const types_1 = require("./types");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    const documentChangeDebounceWait = 200;
    var documentStore = new document_1.DocumentStore();
    var parseTreeStore = new parse_1.ParseTreeStore();
    var symbolStore = new symbol_1.SymbolStore();
    var documentChangeDebounceMap = {};
    var documentSymbolsProvider = new documentSymbols_1.DocumentSymbolsProvider(symbolStore);
    function openDocument(textDocument) {
        if (textDocument.languageId !== phpLanguageId || documentStore.find(textDocument.uri)) {
            return;
        }
        let uri = textDocument.uri;
        let text = textDocument.text;
        let doc = new document_1.TextDocument(uri, text);
        documentStore.add(doc);
        let parseTree = new parse_1.ParseTree(uri, php7parser_1.Parser.parse(text));
        parseTreeStore.add(parseTree);
        let symbolTable = symbol_1.SymbolTable.create(parseTree, doc);
        symbolStore.add(symbolTable);
        documentChangeDebounceMap[textDocument.uri] = new types_1.Debounce(documentChangedEventHandler, documentChangeDebounceWait);
    }
    Intelephense.openDocument = openDocument;
    function closeDocument(textDocument) {
        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.interupt();
            delete documentChangeDebounceMap[textDocument.uri];
        }
        documentStore.remove(textDocument.uri);
        parseTreeStore.remove(textDocument.uri);
    }
    Intelephense.closeDocument = closeDocument;
    function editDocument(textDocument, contentChanges) {
        let doc = documentStore.find(textDocument.uri);
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
        contentChanges.sort(compareFn);
        let change;
        for (let n = 0, l = contentChanges.length; n < l; ++n) {
            change = contentChanges[n];
            doc.applyEdit(change.range.start, change.range.end, change.text);
        }
        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.handle({ textDocument: doc });
        }
    }
    Intelephense.editDocument = editDocument;
    function documentSymbols(textDocument) {
        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.flush();
        }
        return documentSymbolsProvider.provideDocumentSymbols(textDocument.uri);
    }
    Intelephense.documentSymbols = documentSymbols;
    function documentChangedEventHandler(eventArgs) {
        let doc = eventArgs.textDocument;
        let parseTree = new parse_1.ParseTree(doc.uri, php7parser_1.Parser.parse(doc.text));
        parseTreeStore.remove(doc.uri);
        parseTreeStore.add(parseTree);
        let symbolTable = symbol_1.SymbolTable.create(parseTree, doc);
        symbolStore.remove(doc.uri);
        symbolStore.add(symbolTable);
    }
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
