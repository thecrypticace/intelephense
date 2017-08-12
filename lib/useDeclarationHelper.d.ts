import { ParsedDocument } from './parsedDocument';
import { SymbolTable } from './symbolStore';
import { PhpSymbol } from './symbol';
import { Position, TextEdit, Range } from 'vscode-languageserver-types';
import { Phrase } from 'php7parser';
export declare class UseDeclarationHelper {
    doc: ParsedDocument;
    table: SymbolTable;
    private _useDeclarations;
    private _afterNode;
    private _afterNodeEndPosition;
    private _cursor;
    constructor(doc: ParsedDocument, table: SymbolTable, cursor: Position);
    insertDeclarationTextEdit(symbol: PhpSymbol, alias?: string): TextEdit;
    replaceDeclarationTextEdit(symbol: PhpSymbol, alias: string): TextEdit;
    deleteDeclarationTextEdit(fqn: string): void;
    findUseSymbolByFqn(fqn: string): PhpSymbol;
    findUseSymbolByName(name: string): PhpSymbol;
    findNamespaceUseClauseByRange(range: Range): Phrase;
    private _isUseDeclarationSymbol(s);
    private _insertAfterNode();
    private _insertPosition();
    private _isNamespaceAliasingClause(node);
}
