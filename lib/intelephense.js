/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const document_1 = require("./document");
const php7parser_1 = require("php7parser");
const parse_1 = require("./parse");
const symbol_1 = require("./symbol");
const symbolProvider_1 = require("./symbolProvider");
const types_1 = require("./types");
var Intelephense;
(function (Intelephense) {
    const phpLanguageId = 'php';
    const documentChangeDebounceWait = 200;
    var documentStore = new document_1.DocumentStore();
    var parseTreeStore = new parse_1.ParseTreeStore();
    var symbolStore = new symbol_1.SymbolStore();
    var documentChangeDebounceMap = {};
    var symbolProvider = new symbolProvider_1.SymbolProvider(symbolStore);
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
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri);
        symbolStore.add(symbolTable);
        documentChangeDebounceMap[textDocument.uri] = new types_1.Debounce(documentChangedEventHandler, documentChangeDebounceWait);
    }
    Intelephense.openDocument = openDocument;
    function closeDocument(textDocument) {
        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.clear();
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
        documentChangeDebounceFlush(textDocument.uri);
        return symbolProvider.provideDocumentSymbols(textDocument.uri);
    }
    Intelephense.documentSymbols = documentSymbols;
    function workspaceSymbols(query) {
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }
    Intelephense.workspaceSymbols = workspaceSymbols;
    function discover(textDocument) {
        let uri = textDocument.uri;
        if (documentStore.hasDocument(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.count : 0;
        }
        let text = textDocument.text;
        let doc = new document_1.TextDocument(uri, text);
        let parseTree = new parse_1.ParseTree(uri, php7parser_1.Parser.parse(text));
        let symbolTable = symbol_1.SymbolTable.create(parseTree, doc);
        symbolStore.remove(uri);
        symbolStore.add(symbolTable);
        return symbolTable.count;
    }
    Intelephense.discover = discover;
    function forget(uri) {
        let uriArray = symbolStore.getSymbolTableUriArray();
        let fullUri;
        let forgotten = [0, 0];
        let table;
        for (let n = 0, l = uriArray.length; n < l; ++n) {
            fullUri = uriArray[n];
            if (fullUri.indexOf(uri) === 0 && !documentStore.hasDocument(fullUri)) {
                table = symbolStore.getSymbolTable(fullUri);
                symbolStore.remove(fullUri);
                if (table) {
                    forgotten[0]++;
                    forgotten[1] += table.count;
                }
            }
        }
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
    function documentChangeDebounceFlush(uri) {
        let debounce = documentChangeDebounceMap[uri];
        if (debounce) {
            debounce.flush();
        }
    }
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
