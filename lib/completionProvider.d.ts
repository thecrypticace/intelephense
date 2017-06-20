import { SymbolStore } from './symbolStore';
import { ParsedDocumentStore } from './parsedDocument';
import * as lsp from 'vscode-languageserver-types';
export interface CompletionProviderConfig {
    maxItems: number;
}
export declare class CompletionProvider {
    symbolStore: SymbolStore;
    documentStore: ParsedDocumentStore;
    private _maxItems;
    private _strategies;
    private _config;
    private static _defaultConfig;
    constructor(symbolStore: SymbolStore, documentStore: ParsedDocumentStore, config?: CompletionProviderConfig);
    config: CompletionProviderConfig;
    provideCompletions(uri: string, position: lsp.Position): lsp.CompletionList;
}
