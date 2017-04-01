/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { SymbolStore, SymbolTable } from './symbol';
import { SymbolProvider } from './symbolProvider';
import { Debounce } from './types';
import * as lsp from 'vscode-languageserver-types';

export namespace Intelephense {

    const phpLanguageId = 'php';

    let parsedDocumentStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let symbolProvider = new SymbolProvider(symbolStore);
    let unsubscribeParsedDocumentChange = 
        parsedDocumentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange);

    export function openDocument(textDocument: lsp.TextDocumentItem) {

        if (textDocument.languageId !== phpLanguageId || parsedDocumentStore.has(textDocument.uri)) {
            return;
        }

        let parsedDocument = new ParsedDocument(textDocument.uri, textDocument.text);
        parsedDocumentStore.add(parsedDocument);
        let symbolTable = SymbolTable.create(parsedDocument);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri); 
        symbolStore.add(symbolTable);

    }

    export function closeDocument(textDocument: lsp.TextDocumentIdentifier) {
        parsedDocumentStore.remove(textDocument.uri);
    }

    export function editDocument(
        textDocument: lsp.VersionedTextDocumentIdentifier,
        contentChanges: lsp.TextDocumentContentChangeEvent[]) {

        let parsedDocument = parsedDocumentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.applyChanges(contentChanges);
        }

    }

    export function documentSymbols(textDocument: lsp.TextDocumentIdentifier) {
        
        let parsedDocument = parsedDocumentStore.find(textDocument.uri);
        if(parsedDocument){
            parsedDocument.flush();
            return symbolProvider.provideDocumentSymbols(textDocument.uri);
        }
        return [];
    }

    export function workspaceSymbols(query:string){
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }

    export function discover(textDocument: lsp.TextDocumentItem) {

        let uri = textDocument.uri;
    
        if (parsedDocumentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.count : 0;
        }

        let text = textDocument.text;
        let parsedDocument = new ParsedDocument(uri, text);
        let symbolTable = SymbolTable.create(parsedDocument);
        symbolStore.remove(uri);
        symbolStore.add(symbolTable);
        return symbolTable.count;

    }

    export function forget(uri: string): number {
        let forgotten = 0;
        let table = symbolStore.getSymbolTable(uri);
        if(!table || parsedDocumentStore.has(uri)){
            return forgotten;
        }

        forgotten = table.count;
        symbolStore.remove(table.uri);
        return forgotten;
    }

    export function numberDocumentsOpen(){
        return parsedDocumentStore.count;
    }

    export function numberDocumentsKnown() {
        return symbolStore.tableCount;
    }

    export function numberSymbolsKnown() {
        return symbolStore.symbolCount;
    }

}
