import * as lsp from 'vscode-languageserver-types';
import { ParsedDocumentStore } from './parsedDocument';
import { SymbolStore } from './symbolStore';
export declare function importSymbol(symbolStore: SymbolStore, documentStore: ParsedDocumentStore, uri: string, position: lsp.Position, alias?: string): lsp.TextEdit[];
