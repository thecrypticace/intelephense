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
const hoverProvider_1 = require("./hoverProvider");
const highlightProvider_1 = require("./highlightProvider");
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
    let hoverProvider;
    let highlightProvider;
    let cacheClear = false;
    let symbolCache;
    let refCache;
    let stateCache;
    const stateCacheKey = 'state';
    const refStoreCacheKey = 'referenceStore';
    let diagnosticsUnsubscribe;
    let cacheTimestamp = 0;
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
        symbolCache = cache_1.createCache(path.join(options.storagePath, 'intelephense', 'symbols'));
        refCache = cache_1.createCache(path.join(options.storagePath, 'intelephense', 'references'));
        stateCache = cache_1.createCache(path.join(options.storagePath, 'intelephense', 'state'));
        documentStore = new parsedDocument_1.ParsedDocumentStore();
        symbolStore = new symbolStore_1.SymbolStore();
        refStore = new reference_1.ReferenceStore(refCache);
        symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
        completionProvider = new completionProvider_1.CompletionProvider(symbolStore, documentStore, refStore);
        diagnosticsProvider = new diagnosticsProvider_1.DiagnosticsProvider();
        signatureHelpProvider = new signatureHelpProvider_1.SignatureHelpProvider(symbolStore, documentStore, refStore);
        definitionProvider = new definitionProvider_1.DefinitionProvider(symbolStore, documentStore, refStore);
        formatProvider = new formatProvider_1.FormatProvider(documentStore);
        nameTextEditProvider = new commands_1.NameTextEditProvider(symbolStore, documentStore, refStore);
        referenceProvider = new referenceProvider_1.ReferenceProvider(documentStore, symbolStore, refStore);
        hoverProvider = new hoverProvider_1.HoverProvider(documentStore, symbolStore, refStore);
        highlightProvider = new highlightProvider_1.HighlightProvider(documentStore, symbolStore, refStore);
        //keep stores in sync
        documentStore.parsedDocumentChangeEvent.subscribe((args) => {
            symbolStore.onParsedDocumentChange(args);
            let refTable = referenceReader_1.ReferenceReader.discoverReferences(args.parsedDocument, symbolStore);
            refStore.add(refTable);
        });
        if (options.clearCache) {
            return clearCache().then(() => {
                symbolStore.add(symbolStore_1.SymbolTable.readBuiltInSymbols());
            }).catch((msg) => {
                logger_1.Log.warn(msg);
            });
        }
        else {
            symbolStore.add(symbolStore_1.SymbolTable.readBuiltInSymbols());
            return stateCache.read(stateCacheKey).then((data) => {
                if (!data) {
                    return;
                }
                cacheTimestamp = data.timestamp;
                return readCachedSymbolTables(data.documents);
            }).then(() => {
                return refCache.read(refStoreCacheKey);
            }).then((data) => {
                if (data) {
                    refStore.fromJSON(data);
                }
            }).catch((msg) => {
                logger_1.Log.warn(msg);
            });
        }
    }
    Intelephense.initialise = initialise;
    function shutdown() {
        let uris = [];
        for (let t of symbolStore.tables) {
            if (t.uri !== 'php') {
                uris.push(t.uri);
            }
        }
        return stateCache.write(stateCacheKey, { documents: uris, timestamp: Date.now() }).then(() => {
            return refStore.closeAll();
        }).then(() => {
            return refCache.write(refStoreCacheKey, refStore);
        }).then(() => {
            return new Promise((resolve, reject) => {
                let openDocs = documentStore.documents;
                let cacheSymbolTableFn = () => {
                    let doc = openDocs.pop();
                    if (doc) {
                        let symbolTable = symbolStore.getSymbolTable(doc.uri);
                        symbolCache.write(doc.uri, symbolTable).then(cacheSymbolTableFn).catch((msg) => {
                            logger_1.Log.warn(msg);
                            cacheSymbolTableFn();
                        });
                    }
                    else {
                        resolve();
                    }
                };
                cacheSymbolTableFn();
            });
        }).catch((msg) => {
            logger_1.Log.warn(msg);
        });
    }
    Intelephense.shutdown = shutdown;
    function readCachedSymbolTables(keys) {
        if (!keys) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            let count = keys.length;
            if (count < 1) {
                resolve();
            }
            let batch = Math.min(4, count);
            let onCacheReadErr = (msg) => {
                logger_1.Log.warn(msg);
                onCacheRead(undefined);
            };
            let onCacheRead = (data) => {
                --count;
                if (data) {
                    symbolStore.add(new symbolStore_1.SymbolTable(data._uri, data._root, data._hash));
                }
                let uri = keys.pop();
                if (uri) {
                    symbolCache.read(uri).then(onCacheRead).catch(onCacheReadErr);
                }
                else if (count < 1) {
                    resolve();
                }
            };
            let uri;
            while (batch-- > 0 && (uri = keys.pop())) {
                symbolCache.read(uri).then(onCacheRead).catch(onCacheReadErr);
            }
        });
    }
    function clearCache() {
        return stateCache.flush().then(() => {
            return refCache.flush();
        }).then(() => {
            return symbolCache.flush();
        }).catch((msg) => {
            logger_1.Log.warn(msg);
        });
    }
    function provideHighlights(uri, position) {
        return highlightProvider.provideHightlights(uri, position);
    }
    Intelephense.provideHighlights = provideHighlights;
    function provideHover(uri, position) {
        return hoverProvider.provideHover(uri, position);
    }
    Intelephense.provideHover = provideHover;
    function knownDocuments() {
        let uris = new Set();
        for (let t of symbolStore.tables) {
            if (t.uri !== 'php') {
                uris.add(t.uri);
            }
        }
        //check that refs available as well
        for (let uri of refStore.knownDocuments()) {
            if (!uris.has(uri)) {
                uris.delete(uri);
            }
        }
        return { timestamp: cacheTimestamp, documents: Array.from(uris) };
    }
    Intelephense.knownDocuments = knownDocuments;
    function documentLanguageRanges(textDocument) {
        let doc = documentStore.find(textDocument.uri);
        return doc ? { version: doc.version, ranges: doc.documentLanguageRanges() } : undefined;
    }
    Intelephense.documentLanguageRanges = documentLanguageRanges;
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
        let parsedDocument = new parsedDocument_1.ParsedDocument(textDocument.uri, textDocument.text, textDocument.version);
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
        let symbolTable = symbolStore.getSymbolTable(textDocument.uri);
        if (symbolTable) {
            symbolTable.pruneScopedVars();
            return symbolCache.write(symbolTable.uri, symbolTable).catch((msg) => { logger_1.Log.warn(msg); });
        }
    }
    Intelephense.closeDocument = closeDocument;
    function editDocument(textDocument, contentChanges) {
        let parsedDocument = documentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.version = textDocument.version;
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
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text, textDocument.version);
        let symbolTable = symbolStore_1.SymbolTable.create(parsedDocument, true);
        symbolTable.pruneScopedVars();
        symbolStore.add(symbolTable);
        return symbolCache.write(symbolTable.uri, symbolTable).then(() => {
            return symbolTable.symbolCount;
        }).catch((msg) => {
            logger_1.Log.warn(msg);
            return symbolTable.symbolCount;
        });
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
        let parsedDocument = new parsedDocument_1.ParsedDocument(uri, text, textDocument.version);
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
