import { Location, Position } from 'vscode-languageserver-types';
import { SymbolStore } from './symbolStore';
import { ParsedDocumentStore } from './parsedDocument';
export declare class DefinitionProvider {
    symbolStore: SymbolStore;
    documentStore: ParsedDocumentStore;
    constructor(symbolStore: SymbolStore, documentStore: ParsedDocumentStore);
    provideDefinition(uri: string, position: Position): Location | Location[];
}
