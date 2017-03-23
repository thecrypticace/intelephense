import * as lsp from 'vscode-languageserver-types';
export declare namespace Intelephense {
    function openDocument(uri: string, documentText: string): void;
    function closeDocument(uri: string): void;
    function syncDocument(uri: string, documentText: string): void;
    function documentSymbols(uri: string): lsp.SymbolInformation[];
}
