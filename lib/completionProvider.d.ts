import { SymbolStore } from './symbolStore';
import { ParsedDocumentStore } from './parsedDocument';
import * as lsp from 'vscode-languageserver-types';
export declare class CompletionProvider {
    symbolStore: SymbolStore;
    documentStore: ParsedDocumentStore;
    private _maxItems;
    private _strategies;
    constructor(symbolStore: SymbolStore, documentStore: ParsedDocumentStore);
    maxItems: number;
    provideCompletions(uri: string, position: lsp.Position): lsp.CompletionList;
}
