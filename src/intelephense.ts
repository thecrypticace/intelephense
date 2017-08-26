/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { ParsedDocument, ParsedDocumentStore, ParsedDocumentChangeEventArgs } from './parsedDocument';
import { SymbolStore, SymbolTable } from './symbolStore';
import { SymbolProvider } from './symbolProvider';
import { CompletionProvider, CompletionOptions } from './completionProvider';
import { DiagnosticsProvider, PublishDiagnosticsEventArgs } from './diagnosticsProvider';
import { Debounce, Unsubscribe } from './types';
import { SignatureHelpProvider } from './signatureHelpProvider';
import { DefinitionProvider } from './definitionProvider';
import { PhraseType } from 'php7parser';
import { FormatProvider } from './formatProvider';
import * as lsp from 'vscode-languageserver-types';
import { NameTextEditProvider } from './commands';
import { ReferenceReader } from './referenceReader';
import { NameResolver } from './nameResolver';
import { ReferenceProvider } from './referenceProvider';
import { ReferenceParams } from 'vscode-languageserver-protocol';

export namespace Intelephense {

    const phpLanguageId = 'php';
    const htmlLanguageId = 'html';

    let documentStore = new ParsedDocumentStore();
    let symbolStore = new SymbolStore();
    let symbolProvider = new SymbolProvider(symbolStore);
    let completionProvider = new CompletionProvider(symbolStore, documentStore);
    let diagnosticsProvider = new DiagnosticsProvider();
    let signatureHelpProvider = new SignatureHelpProvider(symbolStore, documentStore);
    let definitionProvider = new DefinitionProvider(symbolStore, documentStore);
    let formatProvider = new FormatProvider(documentStore);
    let nameTextEditProvider = new NameTextEditProvider(symbolStore, documentStore);
    let referenceProvider = new ReferenceProvider(documentStore, symbolStore);
    let unsubscribeMap: { [index: string]: Unsubscribe } = {};

    function unsubscribe(key: string) {
        if (typeof unsubscribeMap[key] === 'function') {
            unsubscribe[key]();
            delete unsubscribeMap[key];
        }
    }

    export function onDiagnosticsStart(fn: (uri: string) => void) {
        const key = 'diagnosticsStart';
        unsubscribe(key);

        if (fn) {
            unsubscribeMap[key] = diagnosticsProvider.startDiagnosticsEvent.subscribe(fn);
        }
    }

    export function onPublishDiagnostics(fn: (args: PublishDiagnosticsEventArgs) => void) {
        const key = 'publishDiagnostics';
        unsubscribe(key);

        if (fn) {
            unsubscribeMap[key] = diagnosticsProvider.publishDiagnosticsEvent.subscribe(fn);
        }
    }

    export function initialise() {

        unsubscribeMap['documentChange'] = documentStore.parsedDocumentChangeEvent.subscribe(symbolStore.onParsedDocumentChange);
        symbolStore.add(SymbolTable.readBuiltInSymbols());

    }

    export function setDiagnosticsProviderDebounce(value: number) {
        diagnosticsProvider.debounceWait = value;
    }

    export function setDiagnosticsProviderMaxItems(value: number) {
        diagnosticsProvider.maxItems = value;
    }

    export function setCompletionProviderConfig(config: CompletionOptions) {
        completionProvider.config = config;
    }

    export function openDocument(textDocument: lsp.TextDocumentItem) {

        if ((textDocument.languageId !== phpLanguageId && textDocument.languageId !== htmlLanguageId) || documentStore.has(textDocument.uri)) {
            return;
        }

        let parsedDocument = new ParsedDocument(textDocument.uri, textDocument.text);
        documentStore.add(parsedDocument);
        let symbolTable = SymbolTable.create(parsedDocument);
        //must remove before adding as entry may exist already from workspace discovery
        symbolStore.remove(symbolTable.uri);
        symbolStore.add(symbolTable);
        ReferenceReader.discoverReferences(parsedDocument, symbolTable, symbolStore);
        symbolStore.indexReferences(symbolTable);
        diagnosticsProvider.add(parsedDocument);

    }

    export function closeDocument(textDocument: lsp.TextDocumentIdentifier) {
        documentStore.remove(textDocument.uri);
        diagnosticsProvider.remove(textDocument.uri);
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
        flushParseDebounce(textDocument.uri);
        return symbolProvider.provideDocumentSymbols(textDocument.uri);
    }

    export function workspaceSymbols(query: string) {
        return query ? symbolProvider.provideWorkspaceSymbols(query) : [];
    }

    export function provideCompletions(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position) {
        flushParseDebounce(textDocument.uri);
        return completionProvider.provideCompletions(textDocument.uri, position);
    }

    export function provideSignatureHelp(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position) {
        flushParseDebounce(textDocument.uri);
        return signatureHelpProvider.provideSignatureHelp(textDocument.uri, position);
    }

    export function provideDefinition(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position) {
        flushParseDebounce(textDocument.uri);
        return definitionProvider.provideDefinition(textDocument.uri, position);
    }

    export function discoverSymbols(textDocument: lsp.TextDocumentItem) {

        let uri = textDocument.uri;

        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.
            let symbolTable = symbolStore.getSymbolTable(uri);
            return symbolTable ? symbolTable.symbolCount : 0;
        }

        let text = textDocument.text;
        let parsedDocument = new ParsedDocument(uri, text);
        let symbolTable = SymbolTable.create(parsedDocument, true);
        symbolStore.remove(uri);
        symbolStore.add(symbolTable);
        return symbolTable.symbolCount;

    }

    export function discoverReferences(textDocument: lsp.TextDocumentItem) {
        let uri = textDocument.uri;
        let symbolTable = symbolStore.getSymbolTable(uri);

        if (documentStore.has(uri)) {
            //if document is in doc store/opened then dont rediscover.

            return symbolTable ? symbolTable.referenceCount : 0;
        }

        if (!symbolTable) {
            //symbols must be discovered first
            return 0;
        }

        let text = textDocument.text;
        let parsedDocument = new ParsedDocument(uri, text);
        ReferenceReader.discoverReferences(parsedDocument, symbolTable, symbolStore);
        return symbolTable.referenceCount;
    }

    export function forget(uri: string): number {
        let forgotten = 0;
        let table = symbolStore.getSymbolTable(uri);
        if (!table || documentStore.has(uri)) {
            return forgotten;
        }

        forgotten = table.symbolCount;
        symbolStore.remove(table.uri);
        return forgotten;
    }

    export function provideContractFqnTextEdits(uri: string, position: lsp.Position, alias?: string) {
        flushParseDebounce(uri);
        return nameTextEditProvider.provideContractFqnTextEdits(uri, position, alias);
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

    export function provideDocumentFormattingEdits(doc: lsp.TextDocumentIdentifier, formatOptions: lsp.FormattingOptions) {
        flushParseDebounce(doc.uri);
        return formatProvider.provideDocumentFormattingEdits(doc, formatOptions);
    }

    export function provideDocumentRangeFormattingEdits(doc: lsp.TextDocumentIdentifier, range: lsp.Range, formatOptions: lsp.FormattingOptions) {
        flushParseDebounce(doc.uri);
        return formatProvider.provideDocumentRangeFormattingEdits(doc, range, formatOptions);
    }

    export function provideReferences(params: ReferenceParams) {
        flushParseDebounce(params.textDocument.uri);
        return referenceProvider.provideReferenceLocations(params.textDocument.uri, params.position, params.context);
    }

    function flushParseDebounce(uri: string) {
        let parsedDocument = documentStore.find(uri);
        if (parsedDocument) {
            parsedDocument.flush();
        }
    }

}

