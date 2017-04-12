/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const parsedDocument_1 = require("./parsedDocument");
const symbol_1 = require("./symbol");
const symbolProvider_1 = require("./symbolProvider");
const completionProvider_1 = require("./completionProvider");
const diagnosticsProvider_1 = require("./diagnosticsProvider");
const types_1 = require("./types");
const signatureHelpProvider_1 = require("./signatureHelpProvider");
const definitionProvider_1 = require("./definitionProvider");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    Intelephense.maxCompletions = 100;
    Intelephense.diagnosticsDebounceWait = 1000;
    let documentStore = new parsedDocument_1.ParsedDocumentStore();
    let symbolStore = new symbol_1.SymbolStore();
    let symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
    let completionProvider = new completionProvider_1.CompletionProvider(symbolStore, documentStore, Intelephense.maxCompletions);
    let diagnosticsProvider = new diagnosticsProvider_1.DiagnosticsProvider();
    let signatureHelpProvider = new signatureHelpProvider_1.SignatureHelpProvider(symbolStore, documentStore);
    let definitionProvider = new definitionProvider_1.DefinitionProvider(symbolStore, documentStore);
    let unsubscribes = [];
    unsubscribes.push(documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange));
    let diagnosticsDebounceMap = {};
    unsubscribes.push(documentStore.parsedDocumentChangeEvent.subscribe((args) => {
        let debounce = diagnosticsDebounceMap[args.parsedDocument.uri];
        if (debounce) {
            debounce.handle(args);
        }
    }));
    Intelephense.onDiagnosticsStart = null;
    Intelephense.onDiagnosticsEnd = null;
    function initialise() {
        symbolStore.add(symbol_1.SymbolTable.createBuiltIn());
    }
    Intelephense.initialise = initialise;
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
        //diagnostics
        let dd = diagnosticsDebounceMap[textDocument.uri] = new types_1.Debounce(onDiagnosticsRequest, Intelephense.diagnosticsDebounceWait);
        dd.handle({ parsedDocument: parsedDocument });
    }
    Intelephense.openDocument = openDocument;
    function onDiagnosticsRequest(args) {
        if (typeof Intelephense.onDiagnosticsStart === 'function') {
            Intelephense.onDiagnosticsStart(args.parsedDocument.uri);
        }
        if (typeof Intelephense.onDiagnosticsEnd === 'function') {
            Intelephense.onDiagnosticsEnd(args.parsedDocument.uri, diagnosticsProvider.diagnose(args.parsedDocument));
        }
    }
    function closeDocument(textDocument) {
        documentStore.remove(textDocument.uri);
        //diagnostics
        let dd = diagnosticsDebounceMap[textDocument.uri];
        if (dd) {
            dd.clear();
            delete diagnosticsDebounceMap[textDocument.uri];
        }
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
    function flushParseDebounce(uri) {
        let parsedDocument = documentStore.find(uri);
        if (parsedDocument) {
            parsedDocument.flush();
        }
    }
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
