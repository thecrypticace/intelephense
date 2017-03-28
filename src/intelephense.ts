/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { TextDocument, DocumentStore } from './document';
import { Parser } from 'php7parser';
import { ParseTree, ParseTreeStore } from './parse';
import { SymbolStore, SymbolTable } from './symbol';
import { SymbolProvider } from './symbolProvider';
import { Debounce } from './types';
import * as lsp from 'vscode-languageserver-types';

export namespace Intelephense {

    const phpLanguageId = 'php';
    const documentChangeDebounceWait = 200;

    var documentStore = new DocumentStore();
    var parseTreeStore = new ParseTreeStore();
    var symbolStore = new SymbolStore();
    var documentChangeDebounceMap: { [uri: string]: Debounce<DocumentChangedEventArgs> } = {};

    var symbolProvider = new SymbolProvider(symbolStore);


    export function openDocument(textDocument: lsp.TextDocumentItem) {

        if (textDocument.languageId !== phpLanguageId || documentStore.find(textDocument.uri)) {
            return;
        }

        let uri = textDocument.uri;
        let text = textDocument.text;
        let doc = new TextDocument(uri, text);
        documentStore.add(doc);
        let parseTree = new ParseTree(uri, Parser.parse(text));
        parseTreeStore.add(parseTree);
        let symbolTable = SymbolTable.create(parseTree, doc);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri); 
        symbolStore.add(symbolTable);

        documentChangeDebounceMap[textDocument.uri] = new Debounce<DocumentChangedEventArgs>(
            documentChangedEventHandler,
            documentChangeDebounceWait
        );

    }

    export function closeDocument(textDocument: lsp.TextDocumentIdentifier) {
        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.interupt();
            delete documentChangeDebounceMap[textDocument.uri];
        }
        documentStore.remove(textDocument.uri);
        parseTreeStore.remove(textDocument.uri);
    }

    export function editDocument(
        textDocument: lsp.VersionedTextDocumentIdentifier,
        contentChanges: lsp.TextDocumentContentChangeEvent[]) {

        let doc = documentStore.find(textDocument.uri);

        if (!doc) {
            return;
        }

        let compareFn = (a: lsp.TextDocumentContentChangeEvent, b: lsp.TextDocumentContentChangeEvent) => {
            if (a.range.end.line > b.range.end.line) {
                return -1;
            } else if (a.range.end.line < b.range.end.line) {
                return 1;
            } else {
                return b.range.end.character - a.range.end.character;
            }
        }

        contentChanges.sort(compareFn);
        let change: lsp.TextDocumentContentChangeEvent;

        for (let n = 0, l = contentChanges.length; n < l; ++n) {
            change = contentChanges[n];
            doc.applyEdit(change.range.start, change.range.end, change.text);
        }

        let debounce = documentChangeDebounceMap[textDocument.uri];
        if (debounce) {
            debounce.handle({ textDocument: doc });
        }

    }

    export function documentSymbols(textDocument: lsp.TextDocumentIdentifier) {
        documentChangeDebounceFlush(textDocument.uri);
        return symbolProvider.provideDocumentSymbols(textDocument.uri);
    }

    export function workspaceSymbols(query:string){
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }

    export function discover(textDocument: lsp.TextDocumentItem) {

        let uri = textDocument.uri;
        if (documentStore.hasDocument(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.count : 0;
        }

        let text = textDocument.text;
        let doc = new TextDocument(uri, text);
        let parseTree = new ParseTree(uri, Parser.parse(text));
        let symbolTable = SymbolTable.create(parseTree, doc);
        symbolStore.remove(uri);
        symbolStore.add(symbolTable);
        return symbolTable.count;

    }

    export function forget(uri: string): [number, number] {
        let uriArray = symbolStore.getSymbolTableUriArray();
        let fullUri: string;
        let forgotten: [number, number] = [0, 0];
        let table: SymbolTable;

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

    export function numberDocumentsOpen(){
        return documentStore.count;
    }

    export function numberDocumentsKnown() {
        return symbolStore.tableCount;
    }

    export function numberSymbolsKnown() {
        return symbolStore.symbolCount;
    }

    interface DocumentChangedEventArgs {
        textDocument: TextDocument;
    }

    function documentChangeDebounceFlush(uri:string){
        let debounce = documentChangeDebounceMap[uri];
        if (debounce) {
            debounce.flush();
        }
    }

    function documentChangedEventHandler(eventArgs: DocumentChangedEventArgs) {

        let doc = eventArgs.textDocument
        let parseTree = new ParseTree(doc.uri, Parser.parse(doc.text));
        parseTreeStore.remove(doc.uri);
        parseTreeStore.add(parseTree);
        let symbolTable = SymbolTable.create(parseTree, doc);
        symbolStore.remove(doc.uri);
        symbolStore.add(symbolTable);

    }

}
