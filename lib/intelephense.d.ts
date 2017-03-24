import * as lsp from 'vscode-languageserver-types';
export interface Logger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
}
export declare namespace Intelephense {
    var logger: Logger;
    var enableDebug: boolean;
    function openDocument(uri: string, text: string): void;
    function closeDocument(uri: string): void;
    function editDocument(uri: string, changes: lsp.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(uri: string): lsp.SymbolInformation[];
}
