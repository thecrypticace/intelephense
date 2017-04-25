import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol } from './symbol';
import { SymbolStore } from './symbolStore';
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
    workspaceSymbolFilter(s: PhpSymbol): boolean;
    toDocumentSymbolInformation(s: PhpSymbol): lsp.SymbolInformation;
}
