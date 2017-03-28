import * as lsp from 'vscode-languageserver-types';
import { SymbolStore } from './symbol';
export declare class SymbolProvider {
    symbolStore: SymbolStore;
    constructor(symbolStore: SymbolStore);
    provideDocumentSymbols(uri: string): lsp.SymbolInformation[];
    provideWorkspaceSymbols(query: string): lsp.SymbolInformation[];
}
