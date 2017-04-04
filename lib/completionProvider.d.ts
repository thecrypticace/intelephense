import { SymbolStore } from './symbol';
import { ParsedDocumentStore } from './parsedDocument';
import * as lsp from 'vscode-languageserver-types';
export declare class CompletionProvider {
    symbolStore: SymbolStore;
    documentStore: ParsedDocumentStore;
    maxSuggestions: number;
    private _strategies;
    constructor(symbolStore: SymbolStore, documentStore: ParsedDocumentStore, maxSuggestions: number);
    provideCompletions(uri: string, position: lsp.Position): lsp.CompletionList;
    private _importedSymbolFilter(s);
    private _phraseType(p);
}
