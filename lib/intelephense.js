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
const formatProvider_1 = require("./formatProvider");
const commands_1 = require("./commands");
const referenceReader_1 = require("./referenceReader");
const referenceProvider_1 = require("./referenceProvider");
const reference_1 = require("./reference");
const cache_1 = require("./cache");
const logger_1 = require("./logger");
const path = require("path");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    const htmlLanguageId = 'html';
    let documentStore;
    let symbolStore;
    let refStore;
    let symbolProvider;
    let completionProvider;
    let diagnosticsProvider;
    let signatureHelpProvider;
    let definitionProvider;
    let formatProvider;
    let nameTextEditProvider;
    let referenceProvider;
    let diagnosticsUnsubscribe;
    function onPublishDiagnostics(fn) {
        if (diagnosticsUnsubscribe) {
            diagnosticsUnsubscribe();
        }
        if (fn) {
            diagnosticsUnsubscribe = diagnosticsProvider.publishDiagnosticsEvent.subscribe(fn);
        }
    }
    Intelephense.onPublishDiagnostics = onPublishDiagnostics;
    function initialise(options) {
        if (options.logWriter) {
            logger_1.Log.writer = options.logWriter;
        }
        documentStore = new parsedDocument_1.ParsedDocumentStore();
        symbolStore = new symbolStore_1.SymbolStore();
        refStore = new reference_1.ReferenceStore(cache_1.createCache(path.join(options.storagePath, 'intelephense', 'references')));
        symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
        completionProvider = new completionProvider_1.CompletionProvider(symbolStore, documentStore, refStore);
        diagnosticsProvider = new diagnosticsProvider_1.DiagnosticsProvider();
        signatureHelpProvider = new signatureHelpProvider_1.SignatureHelpProvider(symbolStore, documentStore, refStore);
        definitionProvider = new definitionProvider_1.DefinitionProvider(symbolStore, documentStore, refStore);
        formatProvider = new formatProvider_1.FormatProvider(documentStore);
        nameTextEditProvider = new commands_1.NameTextEditProvider(symbolStore, documentStore, refStore);
        referenceProvider = new referenceProvider_1.ReferenceProvider(documentStore, symbolStore, refStore);
        //keep stores in sync
        documentStore.parsedDocumentChangeEvent.subscribe((args) => {
            symbolStore.onParsedDocumentChange(args);
            let refTable = referenceReader_1.ReferenceReader.discoverReferences(args.parsedDocument, symbolStore);
            refStore.add(refTable);
        });
        symbolStore.add(symbolStore_1.SymbolTable.readBuiltInSymbols());
    }
    Intelephense.initialise = initialise;
    function setConfig(config) {
        diagnosticsProvider.debounceWait = config.diagnosticsProvider.debounce;
        diagnosticsProvider.maxItems = config.diagnosticsProvider.maxItems;
        completionProvider.config = config.completionProvider;
    }
    Intelephense.setConfig = setConfig;
    function openDocument(textDocument) {
        if ((textDocument.languageId !== phpLanguageId && textDocument.languageId !== htmlLanguageId) || documentStore.has(textDocument.uri)) {
            return;
        }
        let parsedDocument = new parsedDocument_1.ParsedDocument(textDocument.uri, textDocument.text);
        documentStore.add(parsedDocument);
        let symbolTable = symbolStore_1.SymbolTable.create(parsedDocument);
        symbolStore.add(symbolTable);
        let refTable = referenceReader_1.ReferenceReader.discoverReferences(parsedDocument, symbolStore);
        refStore.add(refTable);
        diagnosticsProvider.add(parsedDocument);
    }
    Intelephense.openDocument = openDocument;
    function closeDocument(textDocument) {
        documentStore.remove(textDocument.uri);
        refStore.close(textDocument.uri);
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
    function discoverSymbols(textDocument) {
        let uri = textDocument.uri;
        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover
            //it will have symbols discovered already
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.symbolCount : 0;
        }
        let text = textDocument.text;
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text);
        let symbolTable = symbolStore_1.SymbolTable.create(parsedDocument, true);
        symbolStore.add(symbolTable);
        return symbolTable.symbolCount;
    }
    Intelephense.discoverSymbols = discoverSymbols;
    function discoverReferences(textDocument) {
        let uri = textDocument.uri;
        let refTable = refStore.getReferenceTable(uri);
        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.
            //it should have had refs discovered already
            return refTable ? refTable.referenceCount : 0;
        }
        if (!symbolStore.getSymbolTable(uri)) {
            //symbols must be discovered first
            return 0;
        }
        let text = textDocument.text;
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text);
        refTable = referenceReader_1.ReferenceReader.discoverReferences(parsedDocument, symbolStore);
        refStore.add(refTable);
        refStore.close(refTable.uri);
        return refTable.referenceCount;
    }
    Intelephense.discoverReferences = discoverReferences;
    function forget(uri) {
        symbolStore.remove(uri);
        refStore.remove(uri, true);
    }
    Intelephense.forget = forget;
    function provideContractFqnTextEdits(uri, position, alias) {
        flushParseDebounce(uri);
        return nameTextEditProvider.provideContractFqnTextEdits(uri, position, alias);
    }
    Intelephense.provideContractFqnTextEdits = provideContractFqnTextEdits;
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
    function provideDocumentFormattingEdits(doc, formatOptions) {
        flushParseDebounce(doc.uri);
        return formatProvider.provideDocumentFormattingEdits(doc, formatOptions);
    }
    Intelephense.provideDocumentFormattingEdits = provideDocumentFormattingEdits;
    function provideDocumentRangeFormattingEdits(doc, range, formatOptions) {
        flushParseDebounce(doc.uri);
        return formatProvider.provideDocumentRangeFormattingEdits(doc, range, formatOptions);
    }
    Intelephense.provideDocumentRangeFormattingEdits = provideDocumentRangeFormattingEdits;
    function provideReferences(doc, pos, context) {
        flushParseDebounce(doc.uri);
        return referenceProvider.provideReferenceLocations(doc.uri, pos, context);
    }
    Intelephense.provideReferences = provideReferences;
    function flushParseDebounce(uri) {
        let parsedDocument = documentStore.find(uri);
        if (parsedDocument) {
            parsedDocument.flush();
        }
    }
})(Intelephense = exports.Intelephense || (exports.Intelephense = {}));
