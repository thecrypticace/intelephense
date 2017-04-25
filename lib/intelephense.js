/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const symbolStore_1 = require("./symbolStore");
const symbolProvider_1 = require("./symbolProvider");
const completionProvider_1 = require("./completionProvider");
const diagnosticsProvider_1 = require("./diagnosticsProvider");
const signatureHelpProvider_1 = require("./signatureHelpProvider");
const definitionProvider_1 = require("./definitionProvider");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    let documentStore;
    let symbolStore;
    let symbolProvider;
    let completionProvider;
    let diagnosticsProvider;
    let signatureHelpProvider;
    let definitionProvider;
    let unsubscribeMap;
    function unsubscribe(key) {
        if (typeof unsubscribeMap[key] === 'function') {
            unsubscribe[key]();
            delete unsubscribeMap[key];
        }
    }
    function onDiagnosticsStart(fn) {
        const key = 'diagnosticsStart';
        unsubscribe(key);
        if (fn) {
            unsubscribeMap[key] = diagnosticsProvider.startDiagnosticsEvent.subscribe(fn);
        }
    }
    Intelephense.onDiagnosticsStart = onDiagnosticsStart;
    function onPublishDiagnostics(fn) {
        const key = 'publishDiagnostics';
        unsubscribe(key);
        if (fn) {
            unsubscribeMap[key] = diagnosticsProvider.publishDiagnosticsEvent.subscribe(fn);
        }
    }
    Intelephense.onPublishDiagnostics = onPublishDiagnostics;
    function initialise() {
        unsubscribeMap = {};
        documentStore = new parsedDocument_1.ParsedDocumentStore();
        symbolStore = new symbolStore_1.SymbolStore();
        symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
        completionProvider = new completionProvider_1.CompletionProvider(symbolStore, documentStore);
        diagnosticsProvider = new diagnosticsProvider_1.DiagnosticsProvider();
        signatureHelpProvider = new signatureHelpProvider_1.SignatureHelpProvider(symbolStore, documentStore);
        definitionProvider = new definitionProvider_1.DefinitionProvider(symbolStore, documentStore);
        unsubscribeMap['documentChange'] = documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange);
        symbolStore.add(symbolStore_1.SymbolTable.readBuiltInSymbols());
    }
    Intelephense.initialise = initialise;
    function setDiagnosticsProviderDebounce(value) {
        diagnosticsProvider.debounceWait = value;
    }
    Intelephense.setDiagnosticsProviderDebounce = setDiagnosticsProviderDebounce;
    function setDiagnosticsProviderMaxItems(value) {
        diagnosticsProvider.maxItems = value;
    }
    Intelephense.setDiagnosticsProviderMaxItems = setDiagnosticsProviderMaxItems;
    function setCompletionProviderMaxItems(value) {
        completionProvider.maxItems = value;
    }
    Intelephense.setCompletionProviderMaxItems = setCompletionProviderMaxItems;
    function openDocument(textDocument) {
        if (textDocument.languageId !== phpLanguageId || documentStore.has(textDocument.uri)) {
            return;
        }
        let parsedDocument = new parsedDocument_1.ParsedDocument(textDocument.uri, textDocument.text);
        documentStore.add(parsedDocument);
        let symbolTable = symbolStore_1.SymbolTable.create(parsedDocument);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri);
        symbolStore.add(symbolTable);
        diagnosticsProvider.add(parsedDocument);
    }
    Intelephense.openDocument = openDocument;
    function closeDocument(textDocument) {
        documentStore.remove(textDocument.uri);
        diagnosticsProvider.remove(textDocument.uri);
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
        flushParseDebounce(textDocument.uri);
        return symbolProvider.provideDocumentSymbols(textDocument.uri);
    }
    Intelephense.documentSymbols = documentSymbols;
    function workspaceSymbols(query) {
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }
    Intelephense.workspaceSymbols = workspaceSymbols;
    function provideCompletions(textDocument, position) {
        flushParseDebounce(textDocument.uri);
        return completionProvider.provideCompletions(textDocument.uri, position);
    }
    Intelephense.provideCompletions = provideCompletions;
    function provideSignatureHelp(textDocument, position) {
        flushParseDebounce(textDocument.uri);
        return signatureHelpProvider.provideSignatureHelp(textDocument.uri, position);
    }
    Intelephense.provideSignatureHelp = provideSignatureHelp;
    function provideDefinition(textDocument, position) {
        flushParseDebounce(textDocument.uri);
        return definitionProvider.provideDefinition(textDocument.uri, position);
    }
    Intelephense.provideDefinition = provideDefinition;
    function discover(textDocument) {
        let uri = textDocument.uri;
        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.count : 0;
        }
        let text = textDocument.text;
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text);
        let symbolTable = symbolStore_1.SymbolTable.create(parsedDocument, true);
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
    function flushParseDebounce(uri) {
        let parsedDocument = documentStore.find(uri);
        if (parsedDocument) {
            parsedDocument.flush();
        }
    }
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
