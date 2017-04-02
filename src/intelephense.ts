/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { SymbolStore, SymbolTable } from './symbol';
import { SymbolProvider } from './symbolProvider';
import { CompletionProvider } from './completionProvider';
import { Debounce } from './types';
import * as lsp from 'vscode-languageserver-types';

export namespace Intelephense {

    const phpLanguageId = 'php';
    const maxCompletions = 100;

    let documentStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let symbolProvider = new SymbolProvider(symbolStore);
    let completionProvider = new CompletionProvider(symbolStore, documentStore, maxCompletions);
    let unsubscribeParsedDocumentChange = 
        documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange);

    export function openDocument(textDocument: lsp.TextDocumentItem) {

        if (textDocument.languageId !== phpLanguageId || documentStore.has(textDocument.uri)) {
            return;
        }

        let parsedDocument = new ParsedDocument(textDocument.uri, textDocument.text);
        documentStore.add(parsedDocument);
        let symbolTable = SymbolTable.create(parsedDocument);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri); 
        symbolStore.add(symbolTable);

    }

    export function closeDocument(textDocument: lsp.TextDocumentIdentifier) {
        documentStore.remove(textDocument.uri);
    }

    export function editDocument(
        textDocument: lsp.VersionedTextDocumentIdentifier,
        contentChanges: lsp.TextDocumentContentChangeEvent[]) {

        let parsedDocument = documentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.applyChanges(contentChanges);
        }

    }

    export function documentSymbols(textDocument: lsp.TextDocumentIdentifier) {
        
        let parsedDocument = documentStore.find(textDocument.uri);
        if(parsedDocument){
            parsedDocument.flush();
            return symbolProvider.provideDocumentSymbols(textDocument.uri);
        }
        return [];
    }

    export function workspaceSymbols(query:string){
        return query.length > 1 ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }

    export function completions(textDocument:lsp.TextDocumentIdentifier, position:lsp.Position){
        return completionProvider.provideCompletions(textDocument.uri, position);
    }

    export function discover(textDocument: lsp.TextDocumentItem) {

        let uri = textDocument.uri;
    
        if (documentStore.has(uri)) {
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
        if(!table || documentStore.has(uri)){
            return forgotten;
        }

        forgotten = table.count;
        symbolStore.remove(table.uri);
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

}
