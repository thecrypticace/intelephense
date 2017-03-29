import * as lsp from 'vscode-languageserver-types';
import { SymbolStore } from './symbol';
export declare class SymbolProvider {
    symbolStore: SymbolStore;
    constructor(symbolStore: SymbolStore);
    /**
     * Excludes magic symbols
     * @param uri
     */
    provideDocumentSymbols(uri: string): lsp.SymbolInformation[];
    /**
     * Excludes internal symbols
     * @param query
     */
    provideWorkspaceSymbols(query: string): lsp.SymbolInformation[];
}
