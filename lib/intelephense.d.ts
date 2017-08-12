import { CompletionOptions } from './completionProvider';
import { PublishDiagnosticsEventArgs } from './diagnosticsProvider';
import * as lsp from 'vscode-languageserver-types';
export declare namespace Intelephense {
    function onDiagnosticsStart(fn: (uri: string) => void): void;
    function onPublishDiagnostics(fn: (args: PublishDiagnosticsEventArgs) => void): void;
    function initialise(): void;
    function setDiagnosticsProviderDebounce(value: number): void;
    function setDiagnosticsProviderMaxItems(value: number): void;
    function setCompletionProviderConfig(config: CompletionOptions): void;
    function openDocument(textDocument: lsp.TextDocumentItem): void;
    function closeDocument(textDocument: lsp.TextDocumentIdentifier): void;
    function editDocument(textDocument: lsp.VersionedTextDocumentIdentifier, contentChanges: lsp.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(textDocument: lsp.TextDocumentIdentifier): lsp.SymbolInformation[];
    function workspaceSymbols(query: string): lsp.SymbolInformation[];
    function provideCompletions(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): lsp.CompletionList;
    function provideSignatureHelp(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): lsp.SignatureHelp;
    function provideDefinition(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): lsp.Location | lsp.Location[];
    function discoverSymbols(textDocument: lsp.TextDocumentItem): number;
    function discoverReferences(textDocument: lsp.TextDocumentItem): number;
    function forget(uri: string): number;
    function provideContractFqnTextEdits(uri: string, position: lsp.Position, alias?: string): lsp.TextEdit[];
    function numberDocumentsOpen(): number;
    function numberDocumentsKnown(): number;
    function numberSymbolsKnown(): number;
    function provideDocumentFormattingEdits(doc: lsp.TextDocumentIdentifier, formatOptions: lsp.FormattingOptions): lsp.TextEdit[];
    function provideDocumentRangeFormattingEdits(doc: lsp.TextDocumentIdentifier, range: lsp.Range, formatOptions: lsp.FormattingOptions): lsp.TextEdit[];
}
