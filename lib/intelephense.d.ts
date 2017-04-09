import * as lsp from 'vscode-languageserver-types';
export declare namespace Intelephense {
    var maxCompletions: number;
    var diagnosticsDebounceWait: number;
    var onDiagnosticsStart: (uri: string) => void;
    var onDiagnosticsEnd: (uri: string, diagnostics: lsp.Diagnostic[]) => void;
    function openDocument(textDocument: lsp.TextDocumentItem): void;
    function closeDocument(textDocument: lsp.TextDocumentIdentifier): void;
    function editDocument(textDocument: lsp.VersionedTextDocumentIdentifier, contentChanges: lsp.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(textDocument: lsp.TextDocumentIdentifier): lsp.SymbolInformation[];
    function workspaceSymbols(query: string): lsp.SymbolInformation[];
    function provideCompletions(textDocument: lsp.TextDocumentIdentifier, position: lsp.Position): lsp.CompletionList;
    function provideSignatureHelp(uri: string, position: lsp.Position): lsp.SignatureHelp;
    function discover(textDocument: lsp.TextDocumentItem): number;
    function forget(uri: string): number;
    function numberDocumentsOpen(): number;
    function numberDocumentsKnown(): number;
    function numberSymbolsKnown(): number;
}
