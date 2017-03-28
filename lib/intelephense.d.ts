import * as lsp from 'vscode-languageserver-types';
export declare namespace Intelephense {
    function openDocument(textDocument: lsp.TextDocumentItem): void;
    function closeDocument(textDocument: lsp.TextDocumentIdentifier): void;
    function editDocument(textDocument: lsp.VersionedTextDocumentIdentifier, contentChanges: lsp.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(textDocument: lsp.TextDocumentIdentifier): lsp.SymbolInformation[];
    function discover(textDocument: lsp.TextDocumentIdentifier): number;
}
