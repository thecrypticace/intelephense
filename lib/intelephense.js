/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const symbol_1 = require("./symbol");
const symbolProvider_1 = require("./symbolProvider");
const completionProvider_1 = require("./completionProvider");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    const maxCompletions = 100;
    let documentStore = new parsedDocument_1.ParsedDocumentStore();
    let symbolStore = new symbol_1.SymbolStore();
    let symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
    let completionProvider = new completionProvider_1.CompletionProvider(symbolStore, documentStore, maxCompletions);
    let unsubscribeParsedDocumentChange = documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange);
    function openDocument(textDocument) {
        if (textDocument.languageId !== phpLanguageId || documentStore.has(textDocument.uri)) {
            return;
        }
        let parsedDocument = new parsedDocument_1.ParsedDocument(textDocument.uri, textDocument.text);
        documentStore.add(parsedDocument);
        let symbolTable = symbol_1.SymbolTable.create(parsedDocument);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri);
        symbolStore.add(symbolTable);
    }
    Intelephense.openDocument = openDocument;
    function closeDocument(textDocument) {
        documentStore.remove(textDocument.uri);
    }
    Intelephense.closeDocument = closeDocument;
    function editDocument(textDocument, contentChanges) {
        let parsedDocument = documentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.applyChanges(contentChanges);
        }
    }
    Intelephense.editDocument = editDocument;
    function documentSymbols(textDocument) {
        let parsedDocument = documentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.flush();
            return symbolProvider.provideDocumentSymbols(textDocument.uri);
        }
        return [];
    }
    Intelephense.documentSymbols = documentSymbols;
    function workspaceSymbols(query) {
        return query.length > 1 ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }
    Intelephense.workspaceSymbols = workspaceSymbols;
    function completions(textDocument, position) {
        return completionProvider.provideCompletions(textDocument.uri, position);
    }
    Intelephense.completions = completions;
    function discover(textDocument) {
        let uri = textDocument.uri;
        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.count : 0;
        }
        let text = textDocument.text;
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text);
        let symbolTable = symbol_1.SymbolTable.create(parsedDocument);
        symbolStore.remove(uri);
        symbolStore.add(symbolTable);
        return symbolTable.count;
    }
    Intelephense.discover = discover;
    function forget(uri) {
        let forgotten = 0;
        let table = symbolStore.getSymbolTable(uri);
        if (!table || documentStore.has(uri)) {
            return forgotten;
        }
        forgotten = table.count;
        symbolStore.remove(table.uri);
        return forgotten;
    }
    Intelephense.forget = forget;
    function numberDocumentsOpen() {
        return documentStore.count;
    }
    Intelephense.numberDocumentsOpen = numberDocumentsOpen;
    function numberDocumentsKnown() {
        return symbolStore.tableCount;
    }
    Intelephense.numberDocumentsKnown = numberDocumentsKnown;
    function numberSymbolsKnown() {
        return symbolStore.symbolCount;
    }
    Intelephense.numberSymbolsKnown = numberSymbolsKnown;
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
