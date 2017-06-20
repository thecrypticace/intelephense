/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { TreeVisitor, MultiVisitor } from './types';
import {
    Phrase, Token, PhraseType, TokenType,
    QualifiedName
} from 'php7parser';
import { SymbolKind, PhpSymbol } from './symbol';
import { SymbolStore } from './symbolStore';
import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { Predicate, BinarySearch, BinarySearchResult } from './types';
import { NameResolverVisitor } from './nameResolverVisitor';
import { VariableTypeVisitor, VariableTable } from './typeResolver';
import { ParseTreeHelper } from './parseTreeHelper';
import * as lsp from 'vscode-languageserver-types';
import { isInRange } from './util';

export class ReferenceReader extends MultiVisitor<Phrase | Token> {

    constructor(
        public nameResolverVisitor: NameResolverVisitor,
        public variableTypeVisitor: VariableTypeVisitor,
        public referenceVisitor: ReferenceVisitor
    ) {
        super([
            nameResolverVisitor,
            variableTypeVisitor,
            referenceVisitor
        ]);
    }

    get references() {
        return this.referenceVisitor.references;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable) {
        return new ReferenceReader(
            new NameResolverVisitor(document, nameResolver),
            new VariableTypeVisitor(document, nameResolver, symbolStore, variableTable),
            new ReferenceVisitor(document, nameResolver, symbolStore)
        );
    }

}

export class ReferenceVisitor implements TreeVisitor<Phrase | Token> {

    private _references: Reference[];
    private _transformerStack: PhraseTransformer[];

    constructor(
        public doc: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore
    ) {
        this._references = [];
        this._transformerStack = [];
    }

    get references() {
        return new DocumentReferences(this.doc.uri, this._references);
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FullyQualifiedName:
                this._transformerStack.push(
                    new FullyQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.RelativeQualifiedName:
                this._transformerStack.push(
                    new RelativeQualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.QualifiedName:
                this._transformerStack.push(
                    new QualifiedNameTransformer(this.symbolStore, this.doc.nodeRange(node), this.nameResolver, ParseTreeHelper.phraseToReferencesSymbolKind(parent))
                );
                return true;

            case PhraseType.NamespaceName:
                this._transformerStack.push(null);
                return false;

            case undefined:
                //tokens
                return false;

            default:
                this._transformerStack.push(null);
                return true;
        }

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;
        let transformer = (<Phrase>node).phraseType ? this._transformerStack.pop() : null;
        let parentTransformer = this._transformerStack.length ? this._transformerStack[this._transformerStack.length - 1] : null;
        let transform: any;

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.FullyQualifiedName:
                if ((transform = transformer.transform() as Reference)) {
                    this._references.push(transform);
                }

                if (parentTransformer) {
                    parentTransformer.push(transform, node);
                }
                break;

            case PhraseType.NamespaceName:
                if (parentTransformer) {
                    parentTransformer.push(this.doc.nodeText(node), node);
                }
                break;

            default:

                break;

        }


    }



}

class FullyQualifiedNameTransformer implements PhraseTransformer {

    protected _name: string;
    protected _kindPredicate: Predicate<PhpSymbol>;

    constructor(
        public symbolStore: SymbolStore,
        public range: lsp.Range,
        public kind?: SymbolKind
    ) {
        switch (kind) {
            case SymbolKind.Function:
                this._kindPredicate = this.isFunction;
                break;
            case SymbolKind.Constant:
                this._kindPredicate = this.isConstant;
                break;
            default:
                this._kindPredicate = this.isTraitInterfaceClass;
                break;
        }
    }

    push(value: any, node: Phrase | Token) {
        if ((<Phrase>node).phraseType === PhraseType.NamespaceName) {
            this._name = value;
        }
    }

    transform() {

        let name = this.fqn();

        if (!name) {
            return null;
        }

        let matches = this.symbolStore.match(this._name, this._kindPredicate);

        if (matches.length > 0) {
            return <Reference>{
                range: this.range,
                symbol: matches.length > 1 ? matches : matches.pop()
            };
        }

        return null;
    }

    protected fqn() {
        return this._name;
    }

    protected isFunction(x: PhpSymbol) {
        return x.kind === SymbolKind.Function;
    }

    protected isConstant(x: PhpSymbol) {
        return x.kind === SymbolKind.Constant;
    }

    protected isTraitInterfaceClass(x: PhpSymbol) {
        return (x.kind & (SymbolKind.Class | SymbolKind.Trait | SymbolKind.Interface)) > 0;
    }

}

class RelativeQualifiedNameTransformer extends FullyQualifiedNameTransformer {
    constructor(
        public symbolStore: SymbolStore,
        public range: lsp.Range,
        public nameResolver: NameResolver,
        public kind?: SymbolKind
    ) {
        super(symbolStore, range, kind);
    }

    protected fqn() {
        return this.nameResolver.resolveRelative(this._name);
    }
}

class QualifiedNameTransformer extends FullyQualifiedNameTransformer {

    constructor(
        public symbolStore: SymbolStore,
        public range: lsp.Range,
        public nameResolver: NameResolver,
        public kind?: SymbolKind
    ) {
        super(symbolStore, range, kind);
    }

    protected fqn() {
        return this.nameResolver.resolveNotFullyQualified(this._name, this.kind);
    }
}

interface PhraseTransformer {
    push(value: any, node: Phrase | Token);
    transform(): any;
}

export interface Reference {
    range: lsp.Range;
    symbol: PhpSymbol | PhpSymbol[];
    typeString?: string;
}

export class DocumentReferences {

    private _references: Reference[];
    private _uri: string;
    private _search:BinarySearch<Reference>;

    constructor(uri: string, references: Reference[]) {
        this._uri = uri;
        this._references = references;
        this._search = new BinarySearch(this._references);
    }

    filter(predicate: Predicate<Reference>) {
        let matches: Reference[] = [];
        let ref: Reference;
        for (let n = 0, l = this._references.length; n < l; ++n) {
            ref = this._references[n];
            if (predicate(ref)) {
                matches.push(ref);
            }
        }
        return matches;
    }

    referenceAtPosition(position:lsp.Position) {

        let fn = (x:Reference) => {
            return isInRange(position, x.range.start, x.range.end);
        }

        return this._search.find(fn);

    }

}