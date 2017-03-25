import * as vscode from 'vscode-languageserver-types';
export declare namespace Intelephense {
    function openDocument(uri: string, text: string): void;
    function hasDocumentOpen(uri: string): boolean;
    function getDocument(uri: string): vscode.TextDocumentItem;
    function closeDocument(uri: string): void;
    function editDocument(uri: string, changes: vscode.TextDocumentContentChangeEvent[]): void;
    function documentSymbols(uri: string): vscode.SymbolInformation[];
}
