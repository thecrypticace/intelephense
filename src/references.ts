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
import { Predicate } from './types';
import * as lsp from 'vscode-languageserver-types';

export class ReferenceReader extends MultiVisitor<Phrase | Token> {



}

export class ReferenceVisitor implements TreeVisitor<Phrase | Token> {

    private _references: Reference[];
    private _contextStack: any[];

    constructor(
        public doc: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore
    ) {
        this._references = [];
        this._contextStack = [];
    }

    get references() {
        return this._references;
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine[spine.length - 1] as Phrase;
        let context = this._contextStack.pop();
        let parentContext = (this._contextStack.length ? this._contextStack[this._contextStack.length - 1] : null) as any[];

        switch ((<Phrase>node).phraseType) {
            case PhraseType.QualifiedName:

            case PhraseType.RelativeQualifiedName:
            case PhraseType.FullyQualifiedName:

                break;

            case PhraseType.NamespaceName:
                if (parentContext) {
                    parentContext.push(this.doc.nodeText(node));
                }
                break;

            case PhraseType.PropertyAccessExpression:

                break;

            case PhraseType.MethodCallExpression:

                break;

            case PhraseType.ScopedMemberName:

                break;

            default:

                break;

        }


    }

    private qualifiedName(node: Phrase, parent: Phrase, context: any[]) {
        let kind = this.referenceNameSymbolKind(parent);
        let text = context.pop();
        let ref: Reference = {
            range: this.doc.nodeRange(node),
            symbol: null
        };

        if (!text) {
            return null;
        }

        if (
            text.indexOf('\\') < 0 &&
            (ref.symbol = this.nameResolver.matchImportedSymbol(text, kind))
        ) {
            //reference the import rule
            return ref;
        }

        //reference the actual symbol 
        text = this.nameResolver.resolveNotFullyQualified(text, kind);
        let pred: Predicate<PhpSymbol> = (x) => {
            return x.kind === kind;
        };

        ref.symbol = this.symbolStore.find(text, pred);
        return ref.symbol ? ref : null;

    }

    private referenceNameSymbolKind(node: Phrase) {
        switch (node.phraseType) {
            case PhraseType.ConstantAccessExpression:
                return SymbolKind.Constant;
            case PhraseType.FunctionCallExpression:
                return SymbolKind.Function;
            default:
                return SymbolKind.Class;
        }
    }

    private _qualifiedName(node: QualifiedName, parent: Phrase) {
        let kind = SymbolKind.Class;
        if (parent.phraseType === PhraseType.ConstantAccessExpression) {
            kind = SymbolKind.Constant;
        } else if (parent.phraseType === PhraseType.FunctionCallExpression) {
            kind = SymbolKind.Function;
        }

        let ref: Reference = {
            range: this.doc.nodeRange(node),
            symbol: null
        };

        let text = this.doc.nodeText(node.name, [TokenType.Whitespace, TokenType.Comment]);

        if (
            node.phraseType === PhraseType.QualifiedName &&
            text.indexOf('\\') < 0 &&
            (ref.symbol = this.nameResolver.matchImportedSymbol(text, kind))
        ) {
            //reference the import rule
            return ref;
        }

        //reference the actual symbol 
        if (node.phraseType === PhraseType.QualifiedName) {
            text = this.nameResolver.resolveNotFullyQualified(text, kind);
        } else if (node.phraseType === PhraseType.RelativeQualifiedName) {
            text = this.nameResolver.resolveRelative(text);
        }

        let pred: Predicate<PhpSymbol> = (x) => {
            return x.kind === kind;
        };
        ref.symbol = this.symbolStore.find(text, pred);

        if (ref.symbol) {
            this._references.push(ref);
            return ref;
        }

        return null;

    }


}

class FullyQualifiedNameTransform implements PhraseTransform {

    protected _name: string;

    constructor(
        public symbolStore: SymbolStore,
        public range: lsp.Range,
        public kind?: SymbolKind
    ) { }

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

        let k = this.kind;
        let p = (x: PhpSymbol) => {
            return (x.kind & k) > 0;
        }

        let matches = this.symbolStore.match(this._name, p);

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

}

class RelativeQualifiedNameTransform extends FullyQualifiedNameTransform {
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

class QualifiedNameTransform extends FullyQualifiedNameTransform {

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

interface PhraseTransform {
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

    constructor(uri: string, references: Reference[]) {
        this._uri
        this._references = [];
    }

    add(ref: Reference) {
        this._references.push(ref);
    }

    match(predicate: Predicate<Reference>) {
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

}