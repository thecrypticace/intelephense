/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { ParsedDocument, ParsedDocumentStore, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { SymbolStore, SymbolTable } from './symbol';
import { SymbolProvider } from './symbolProvider';
import { CompletionProvider } from './completionProvider';
import { DiagnosticsProvider } from './diagnosticsProvider';
import { Debounce, Unsubscribe } from './types';
import * as lsp from 'vscode-languageserver-types';

export namespace Intelephense {

    const phpLanguageId = 'php';
    export var maxCompletions = 100;
    export var diagnosticsDebounceWait = 1000;

    let documentStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let symbolProvider = new SymbolProvider(symbolStore);
    let completionProvider = new CompletionProvider(symbolStore, documentStore, maxCompletions);
    let diagnosticsProvider = new DiagnosticsProvider();

    let unsubscribes: Unsubscribe[] = [];
    unsubscribes.push(documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange));

    let diagnosticsDebounceMap: { [uri: string]: Debounce<DiagnosticsEventArgs> } = {};
    unsubscribes.push(documentStore.parsedDocumentChangeEvent.subscribe((args) => {
        let debounce = diagnosticsDebounceMap[args.parsedDocument.uri];
        if (debounce) {
            debounce.handle(args);
        }
    }));

    interface DiagnosticsEventArgs {
        parsedDocument: ParsedDocument;
    }

    export var onDiagnosticsStart: (uri: string) => void = null
    export var onDiagnosticsEnd: (uri: string, diagnostics: lsp.Diagnostic[]) => void = null;

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

        //diagnostics
        let dd = diagnosticsDebounceMap[textDocument.uri] = new Debounce<DiagnosticsEventArgs>(
            onDiagnosticsRequest,
            diagnosticsDebounceWait
        );
        dd.handle({ parsedDocument: parsedDocument });

    }

    function onDiagnosticsRequest(args: DiagnosticsEventArgs) {

        if (typeof onDiagnosticsStart === 'function') {
            onDiagnosticsStart(args.parsedDocument.uri);
        }

        if (typeof onDiagnosticsEnd === 'function') {
            onDiagnosticsEnd(args.parsedDocument.uri, diagnosticsProvider.diagnose(args.parsedDocument));
        }
    }

    export function closeDocument(textDocument: lsp.TextDocumentIdentifier) {
        documentStore.remove(textDocument.uri);
        //diagnostics
        let dd = diagnosticsDebounceMap[textDocument.uri];
        if (dd) {
            dd.clear();
            delete diagnosticsDebounceMap[textDocument.uri];
        }
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
        if (parsedDocument) {
            parsedDocument.flush();
            return symbolProvider.provideDocumentSymbols(textDocument.uri);
        }
        return [];
    }

    export function workspaceSymbols(query: string) {
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }

    export function completions(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position) {
        let parsedDocument = documentStore.find(textDocument.uri);
        if (parsedDocument) {
            parsedDocument.flush();
            return completionProvider.provideCompletions(textDocument.uri, position);
        }
        return <lsp.CompletionList>{ items: [] };

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
        if (!table || documentStore.has(uri)) {
            return forgotten;
        }

        forgotten = table.count;
        symbolStore.remove(table.uri);
        return forgotten;
    }

    export function numberDocumentsOpen() {
        return documentStore.count;
    }

    export function numberDocumentsKnown() {
        return symbolStore.tableCount;
    }

    export function numberSymbolsKnown() {
        return symbolStore.symbolCount;
    }

}
