import * as lsp from 'vscode-languageserver-types';
import { SymbolKind } from './symbol';
import { NameResolver } from './nameResolver';
import { ParsedDocument } from './parsedDocument';
import { Phrase, Token, TokenType, NamespaceUseDeclaration } from 'php7parser';
import { TreeVisitor } from './types';
/**
 * Base class for parsed document visitors.
 * This class comes equipped with a name resolver that will collect namespace definition
 * and use declaration symbols (or come prepopulated with them) for use in resolving fully qualified names
 *
 * Don't return false when visiting namespace definitions and namespace use declarations -- name resolving will be buggy
 *
 * If not descending into children and wishinf to halt make sure to use _containsHaltOffset
 * _preorder still runs on the token containing the haltOffset.
 *
 */
export declare abstract class ParsedDocumentVisitor implements TreeVisitor<Phrase | Token> {
    document: ParsedDocument;
    nameResolver: NameResolver;
    private _namespaceUseDeclarationKind;
    private _namespaceUseDeclarationPrefix;
    haltTraverse: boolean;
    haltAtOffset: number;
    constructor(document: ParsedDocument, nameResolver: NameResolver);
    preorder(node: Phrase | Token, spine: (Phrase | Token)[]): any;
    postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _classDeclarationHeader(node);
    private _anonymousClassDeclaration(node);
    private _namespaceUseClause(node, kind, prefix);
    protected _tokenToSymbolKind(t: Token): SymbolKind;
    protected _namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string];
    protected abstract _preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    protected abstract _postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    protected _containsHaltOffset(node: Phrase | Token): boolean;
    protected _nodeText(node: Phrase | Token, ignore?: TokenType[]): string;
    protected _nodeRange(node: Phrase | Token): lsp.Range;
    protected _nodeLocation(node: Phrase | Token): lsp.Location;
    protected _createAnonymousName(node: Phrase): string;
    /**
     * Resolves name node to FQN
     * @param node
     * @param kind needed to resolve qualified names against import rules
     */
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind): string;
    protected _namespaceNamePhraseToString(node: Phrase | Token): string;
}
