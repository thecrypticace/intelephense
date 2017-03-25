import * as lsp from 'vscode-languageserver-types';
export declare namespace Intelephense {
    function openDocument(uri: string, text: string): void;
    function isDocumentOpen(uri: string): boolean;
    function closeDocument(uri: string): void;
    function editDocument(uri: string, changes: lsp.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(uri: string): lsp.SymbolInformation[];
}
