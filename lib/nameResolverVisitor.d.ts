import { SymbolKind } from './symbol';
import { NameResolver } from './nameResolver';
import { ParsedDocument } from './parsedDocument';
import { Phrase, Token } from 'php7parser';
import { TreeVisitor } from './types';
export declare class NameResolverVisitor implements TreeVisitor<Phrase | Token> {
    document: ParsedDocument;
    nameResolver: NameResolver;
    private _namespaceUseDeclarationKind;
    private _namespaceUseDeclarationPrefix;
    constructor(document: ParsedDocument, nameResolver: NameResolver);
    preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _classDeclarationHeader(node);
    private _anonymousClassDeclarationHeader(node, parent);
    private _namespaceUseClause(node, kind, prefix);
    protected _tokenToSymbolKind(t: Token): SymbolKind;
    /**
     * Resolves name node to FQN
     * @param node
     * @param kind needed to resolve qualified names against import rules
     */
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind): string;
}
