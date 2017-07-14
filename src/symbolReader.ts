/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { NameResolverVisitor } from './nameResolverVisitor';
import { TreeVisitor, MultiVisitor } from './types';
import { ParsedDocument, NodeTransform, TokenTransform } from './parsedDocument';
import {
    Phrase, PhraseType, Token, TokenType
} from 'php7parser';
import { PhpDoc, PhpDocParser, Tag, MethodTagParam } from './phpDoc';
import { PhpSymbol, SymbolKind, SymbolModifier, PhpSymbolDoc } from './symbol';
import { NameResolver } from './nameResolver';
import { TypeString } from './typeString';
import { Location } from 'vscode-languageserver-types';


export class SymbolReader extends MultiVisitor<Phrase | Token> {

    private _symbolVisitor: SymbolVisitor;

    constructor(
        nameResolverVisitor: NameResolverVisitor,
        symbolVisitor: SymbolVisitor
    ) {
        super([nameResolverVisitor, symbolVisitor]);
        this._symbolVisitor = symbolVisitor;
    }

    set externalOnly(v: boolean) {
        this._symbolVisitor.externalOnly = v;
    }

    get symbols() {
        return this._symbolVisitor.symbols;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver) {
        return new SymbolReader(
            new NameResolverVisitor(document, nameResolver),
            new SymbolVisitor(document, nameResolver)
        );
    }

}

export class SymbolVisitor implements TreeVisitor<Phrase | Token> {

    private static _varAncestors = [
        PhraseType.ListIntrinsic, PhraseType.ForeachKey, PhraseType.ForeachValue,
        PhraseType.ByRefAssignmentExpression, PhraseType.CompoundAssignmentExpression,
        PhraseType.SimpleAssignmentExpression
    ];

    private static _builtInTypes = [
        'array', 'callable', 'int', 'string', 'bool', 'float', 'iterable'
    ];

    private static _globalVars = [
        '$GLOBALS',
        '$_SERVER',
        '$_GET',
        '$_POST',
        '$_FILES',
        '$_REQUEST',
        '$_SESSION',
        '$_ENV',
        '$_COOKIE',
        '$php_errormsg',
        '$HTTP_RAW_POST_DATA',
        '$http_response_header',
        '$argc',
        '$argv',
        '$this'
    ];

    lastPhpDoc: PhpDoc;
    lastPhpDocLocation: Location;
    externalOnly = false;

    private _transformStack: NodeTransform[];

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver
    ) {
        this._transformStack = [new InitialTransform()];
    }

    get symbols() {
        return this._transformStack[0].value;
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let s: PhpSymbol;
        let parentNode = <Phrase>(spine.length ? spine[spine.length - 1] : { phraseType: PhraseType.Unknown, children: [] });
        let parentTransform = this._transformStack[this._transformStack.length - 1];

        switch ((<Phrase>node).phraseType) {

            //case PhraseType.Error:
            //    return false;

            case PhraseType.NamespaceDefinition:
                this._transformStack.push(new NamespaceDefinitionTransform(this.document.nodeLocation(node)));
                break;

            case PhraseType.ConstElement:
                this._transformStack.push(
                    new ConstElementTransform(this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                    ));
                break;

            case PhraseType.FunctionDeclaration:
                this._transformStack.push(new FunctionDeclarationTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.FunctionDeclarationHeader:
                this._transformStack.push(new FunctionDeclarationHeaderTransform());
                break;

            case PhraseType.ParameterDeclarationList:
                this._transformStack.push(new DelimiteredListTransform(PhraseType.ParameterDeclarationList, TokenType.Comma));
                break;

            case PhraseType.ParameterDeclaration:
                this._transformStack.push(new ParameterDeclarationTransform(
                    this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.TypeDeclaration:
                this._transformStack.push(new TypeDeclarationTransform());
                break;

            case PhraseType.ReturnType:
                this._transformStack.push(new ReturnTypeTransform());
                break;

            case PhraseType.FunctionDeclarationBody:
                this._transformStack.push(new FunctionDeclarationBodyTransform(PhraseType.MethodDeclarationBody));
                if (this.externalOnly) {
                    return false;
                }
                break;

            case PhraseType.ClassDeclaration:
                this._transformStack.push(new ClassDeclarationTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.ClassDeclarationHeader:
                this._transformStack.push(new ClassDeclarationHeaderTransform());
                break;

            case PhraseType.ClassBaseClause:
                this._transformStack.push(new ClassBaseClauseTransform());
                break;

            case PhraseType.ClassInterfaceClause:
                this._transformStack.push(new ClassInterfaceClauseTransform());
                break;

            case PhraseType.QualifiedNameList:
                if (parentTransform) {
                    this._transformStack.push(new DelimiteredListTransform(PhraseType.QualifiedNameList, TokenType.Comma));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.ClassDeclarationBody:
                this._transformStack.push(new TypeDeclarationBodyTransform(PhraseType.ClassDeclarationBody));
                break;

            case PhraseType.InterfaceDeclaration:
                this._transformStack.push(new InterfaceDeclarationTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.InterfaceDeclarationHeader:
                this._transformStack.push(new InterfaceDeclarationHeaderTransform());
                break;

            case PhraseType.InterfaceBaseClause:
                this._transformStack.push(new InterfaceBaseClauseTransform());
                break;

            case PhraseType.InterfaceDeclarationBody:
                this._transformStack.push(new TypeDeclarationBodyTransform(PhraseType.InterfaceDeclarationBody));
                break;

            case PhraseType.TraitDeclaration:
                this._transformStack.push(new TraitDeclarationTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.TraitDeclarationHeader:
                this._transformStack.push(new TraitDeclarationHeaderTransform());
                break;

            case PhraseType.TraitDeclarationBody:
                this._transformStack.push(new TypeDeclarationBodyTransform(PhraseType.TraitDeclarationBody));
                break;

            case PhraseType.ClassConstDeclaration:
                this._transformStack.push(new FieldDeclarationTransform(PhraseType.ClassConstDeclaration, PhraseType.ClassConstElement));
                break;

            case PhraseType.ClassConstElementList:
                this._transformStack.push(new DelimiteredListTransform(PhraseType.ClassConstElementList, TokenType.Comma));
                break;

            case PhraseType.ClassConstElement:
                this._transformStack.push(new ClassConstantElementTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.PropertyDeclaration:
                this._transformStack.push(new FieldDeclarationTransform(PhraseType.PropertyDeclaration, PhraseType.PropertyElement));
                break;

            case PhraseType.PropertyElementList:
                this._transformStack.push(new DelimiteredListTransform(PhraseType.PropertyElementList, TokenType.Comma));
                break;

            case PhraseType.PropertyElement:
                this._transformStack.push(new PropertyElementTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.PropertyInitialiser:
                this._transformStack.push(new PropertyInitialiserTransform());
                break;

            case PhraseType.TraitUseClause:
                this._transformStack.push(new TraitUseClauseTransform());
                break;

            case PhraseType.MethodDeclaration:
                this._transformStack.push(new MethodDeclarationTransform(
                    this.nameResolver, this.document.nodeLocation(node), this.lastPhpDoc, this.lastPhpDocLocation
                ));
                break;

            case PhraseType.MethodDeclarationHeader:
                this._transformStack.push(new MethodDeclarationHeaderTransform());
                break;

            case PhraseType.Identifier:
                if(parentNode.phraseType === PhraseType.MethodDeclarationHeader) {
                    this._transformStack.push(new IdentifierTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.MemberModifierList:
                this._transformStack.push(new MemberModifierListTransform());
                break;

            case PhraseType.MethodDeclarationBody:
                this._transformStack.push(new FunctionDeclarationBodyTransform(PhraseType.MethodDeclarationBody));
                if (this.externalOnly) {
                    return false;
                }
                break;

            case PhraseType.AnonymousClassDeclaration:
                this._transformStack.push(new AnonymousClassDeclarationTransform(
                    this.document.nodeLocation(node), this.document.createAnonymousName(<Phrase>node)
                ));
                break;

            case PhraseType.AnonymousClassDeclarationHeader:
                this._transformStack.push(new AnonymousClassDeclarationHeaderTransform());
                break;

            case PhraseType.AnonymousFunctionCreationExpression:
                this._transformStack.push(new AnonymousFunctionCreationExpressionTransform(
                    this.document.nodeLocation(node), this.document.createAnonymousName(<Phrase>node)
                ));
                break;

            case PhraseType.AnonymousFunctionHeader:
                this._transformStack.push(new AnonymousFunctionHeaderTransform());
                break;

            case PhraseType.AnonymousFunctionUseClause:
                this._transformStack.push(new AnonymousFunctionUseClauseTransform());
                break;

            case PhraseType.ClosureUseList:
                this._transformStack.push(new DelimiteredListTransform(PhraseType.ClosureUseList, TokenType.Comma));
                break;

            case PhraseType.AnonymousFunctionUseVariable:
                this._transformStack.push(new AnonymousFunctionUseVariableTransform(this.document.nodeLocation(node)));
                break;

            case PhraseType.SimpleVariable:
                this._transformStack.push(new SimpleVariableTransform(this.document.nodeLocation(node)));
                break;

            case PhraseType.FunctionCallExpression:
                //define
                if ((<Phrase>node).children.length) {
                    let name = this.document.nodeText((<Phrase>node).children[0]).toLowerCase();
                    if (name === 'define' || name === '\\define') {
                        this._transformStack.push(new DefineFunctionCallExpressionTransform(this.document.nodeLocation(node)));
                        break;
                    }
                }
                this._transformStack.push(null);
                break;

            case PhraseType.ArgumentExpressionList:
                if (parentNode.phraseType === PhraseType.FunctionCallExpression && parentTransform) {
                    this._transformStack.push(new DelimiteredListTransform(PhraseType.ArgumentExpressionList, TokenType.Comma));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.FullyQualifiedName:
                if (parentTransform) {
                    this._transformStack.push(new FullyQualifiedNameTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.RelativeQualifiedName:
                if (parentTransform) {
                    this._transformStack.push(new RelativeQualifiedNameTransform(this.nameResolver));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.QualifiedName:
                if (parentTransform) {
                    this._transformStack.push(new QualifiedNameTransform(this.nameResolver));
                } else {
                    this._transformStack.push(null);
                }
                break;

            case PhraseType.NamespaceName:
                if (parentTransform) {
                    this._transformStack.push(new NamespaceNameTransform());
                } else {
                    this._transformStack.push(null);
                }
                break;

            case undefined:
                //tokens
                if ((<Token>node).tokenType === TokenType.DocumentComment) {

                    this.lastPhpDoc = PhpDocParser.parse(this.document.nodeText(node));
                    this.lastPhpDocLocation = this.document.nodeLocation(node);

                } else if ((<Token>node).tokenType === TokenType.CloseBrace) {

                    this.lastPhpDoc = null;
                    this.lastPhpDocLocation = null;

                } else if ((<Token>node).tokenType === TokenType.VariableName && parentNode.phraseType === PhraseType.CatchClause) {
                    //catch clause vars
                    parentTransform.push(new CatchClauseVariableNameTransform(this.document.tokenText(<Token>node), this.document.nodeLocation(node)));

                } else if (parentTransform && this._shouldTransformToken(<Token>node)) {

                    parentTransform.push(new TokenTransform(this.document, <Token>node));

                }
                break;

            default:

                if (
                    parentNode.phraseType === PhraseType.ConstElement ||
                    parentNode.phraseType === PhraseType.ClassConstElement ||
                    parentNode.phraseType === PhraseType.ParameterDeclaration ||
                    (parentNode.phraseType === PhraseType.ArgumentExpressionList && parentTransform)
                ) {
                    this._transformStack.push(new DefaultNodeTransform((<Phrase>node).phraseType, this.document.nodeText(node)));
                } else {
                    this._transformStack.push(null);
                }
                break;
        }

        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        if(!(<Phrase>node).phraseType) {
            return;
        }

        let transform = this._transformStack.pop();
        if(!transform){
            return;
        }

        for(let n = this._transformStack.length - 1; n > -1; --n) {
            if(this._transformStack[n]) {
                this._transformStack[n].push(transform);
                break;
            }
        }

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclarationHeader:
            case PhraseType.MethodDeclarationHeader:
            case PhraseType.ClassDeclarationHeader:
            case PhraseType.InterfaceDeclarationHeader:
            case PhraseType.TraitDeclarationHeader:
            case PhraseType.AnonymousFunctionHeader:
            case PhraseType.AnonymousClassDeclarationHeader:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }

    }

    private _shouldTransformToken(t: Token) {
        switch (t.tokenType) {
            case TokenType.Whitespace:
            case TokenType.Comment:
            case TokenType.Comma:
            case TokenType.Equals:
            case TokenType.OpenBrace:
            case TokenType.CloseBrace:
            case TokenType.OpenParenthesis:
            case TokenType.CloseParenthesis:
                return false;
            default:
                return true;
        }
    }

}

/**
 * Ensures that there are no variable and parameter symbols with same name
 * and excludes inbuilt vars
 */
class UniqueSymbolCollection {

    private _symbols: PhpSymbol[];
    private _varMap: { [index: string]: boolean };
    private static _inbuilt = {
        '$GLOBALS': true,
        '$_SERVER': true,
        '$_GET': true,
        '$_POST': true,
        '$_FILES': true,
        '$_REQUEST': true,
        '$_SESSION': true,
        '$_ENV': true,
        '$_COOKIE': true,
        '$php_errormsg': true,
        '$HTTP_RAW_POST_DATA': true,
        '$http_response_header': true,
        '$argc': true,
        '$argv': true,
        '$this': true
    };

    constructor() {
        this._symbols = [];
        this._varMap = Object.assign({}, UniqueSymbolCollection._inbuilt);
    }

    push(s: PhpSymbol) {
        if (s.kind & (SymbolKind.Parameter | SymbolKind.Variable)) {
            if (this._varMap[s.name] === undefined) {
                this._varMap[s.name] = true;
                this._symbols.push(s);
            }
        } else {
            this._symbols.push(s);
        }
    }

    toArray() {
        return this._symbols;
    }
}

class InitialTransform implements NodeTransform {

    value: UniqueSymbolCollection;
    phraseType = PhraseType.StatementList;

    constructor() {
        this.value = new UniqueSymbolCollection();
    }

    push(transform: NodeTransform) {

        let value = transform.value as PhpSymbol;
        if (value && value.kind !== undefined) {
            this.value.push(value);
        }

    }

}

class IdentifierTransform implements NodeTransform {

    phraseType = PhraseType.Identifier;
    value = '';

    push(transform:NodeTransform) {
        this.value = transform.value;
    }

}

class CatchClauseVariableNameTransform implements NodeTransform {
    tokenType = TokenType.VariableName;
    value: PhpSymbol;

    constructor(name: string, location: Location) {
        this.value = PhpSymbol.create(SymbolKind.Variable, name, location);
    }

    push(transform: NodeTransform) { }
}

class ParameterDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.ParameterDeclaration;
    value: PhpSymbol;

    constructor(location: Location, doc: PhpDoc, docLocation: Location) {
        this.value = PhpSymbol.create(SymbolKind.Parameter, '', location);
        this.value.modifiers = 0;
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.TypeDeclaration) {
            this.value.type = transform.value;
        } else if (transform.tokenType === TokenType.Ampersand) {
            this.value.modifiers |= SymbolModifier.Reference;
        } else if (transform.tokenType === TokenType.Ellipsis) {
            this.value.modifiers |= SymbolModifier.Variadic;
        } else if (transform.tokenType === TokenType.VariableName) {
            this.value.name = transform.value;
        } else if (
            transform.tokenType !== TokenType.Equals &&
            transform.tokenType !== TokenType.Whitespace &&
            transform.tokenType !== TokenType.Comment &&
            transform.tokenType !== TokenType.DocumentComment
        ) {
            this.value.value = transform.value;
        }
    }

}

class DefineFunctionCallExpressionTransform implements NodeTransform {

    phraseType = PhraseType.FunctionCallExpression;
    value: PhpSymbol;

    constructor(location: Location) {
        this.value = PhpSymbol.create(SymbolKind.Constant, '', location);
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.ArgumentExpressionList) {
            let v = transform.value as string[];
            this.value.name = (v.shift() || '').slice(1, -1); //remove quotes
            this.value.value = v.shift() || '';
            if (this.value.name.slice(0, 1) === '\\') {
                this.value.name = this.value.name.slice(1);
            }
        }
    }

}

class SimpleVariableTransform implements NodeTransform {

    phraseType = PhraseType.SimpleVariable;
    value: PhpSymbol;

    constructor(location: Location) {
        this.value = PhpSymbol.create(SymbolKind.Variable, '', location);
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.VariableName) {
            this.value.name = transform.value;
        }
    }

}

class AnonymousClassDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.AnonymousClassDeclaration;
    value: PhpSymbol;

    constructor(location: Location, name: string) {
        this.value = PhpSymbol.create(SymbolKind.Class, name, location);
        this.value.modifiers = SymbolModifier.Anonymous;
        this.value.children = [];
        this.value.associated = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.AnonymousClassDeclarationHeader) {
            let v = transform.value as [PhpSymbol, PhpSymbol[]];
            if (v[0]) {
                this.value.associated.push(v[0]);
            }
            Array.prototype.push.apply(this.value.associated, v[1]);
        } else if (transform.phraseType === PhraseType.ClassDeclarationBody) {
            let v = transform.value as [PhpSymbol[], PhpSymbol[]];
            Array.prototype.push.apply(this.value.children, PhpSymbol.setScope(v[0], this.value.name))
            Array.prototype.push.apply(this.value.associated, v[1]);
        }
    }

}

class TypeDeclarationBodyTransform implements NodeTransform {

    /**
     * [declarations, use traits]
     */
    value: [PhpSymbol[], PhpSymbol[]];

    constructor(public phraseType: PhraseType) {
        this.value = [[], []];
    }

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.ClassConstDeclaration:
            case PhraseType.PropertyDeclaration:
                Array.prototype.push.apply(this.value[0], <PhpSymbol[]>transform.value);
                break;

            case PhraseType.MethodDeclaration:
                this.value[0].push(transform.value);
                break;

            case PhraseType.TraitUseClause:
                Array.prototype.push.apply(this.value[1], transform.value);
                break;

            default:
                break;

        }
    }

}

class AnonymousClassDeclarationHeaderTransform implements NodeTransform {

    phraseType = PhraseType.AnonymousClassDeclarationHeader;
    value: [PhpSymbol, PhpSymbol[]];

    constructor() {
        this.value = [undefined, []];
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.ClassBaseClause) {
            this.value[0] = transform.value;
        } else if (transform.phraseType === PhraseType.ClassInterfaceClause) {
            this.value[1] = transform.value;
        }

    }

}

class AnonymousFunctionCreationExpressionTransform implements NodeTransform {

    phraseType = PhraseType.AnonymousFunctionCreationExpression;
    private _value: PhpSymbol;
    private _children: UniqueSymbolCollection;

    constructor(location: Location, name: string) {
        this._value = PhpSymbol.create(SymbolKind.Function, name, location);
        this._value.modifiers = SymbolModifier.Anonymous;
        this._children = new UniqueSymbolCollection();
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.AnonymousFunctionHeader) {
            let v = transform.value as [SymbolModifier, PhpSymbol[], PhpSymbol[], string];
            this._value.modifiers |= v[0];
            UniqueSymbolCollection.prototype.push.apply(this._children, v[1]);
            UniqueSymbolCollection.prototype.push.apply(this._children, v[2]);
            this._value.type = v[3];
        } else if (transform.phraseType === PhraseType.FunctionDeclarationBody) {
            UniqueSymbolCollection.prototype.push.apply(this._children, transform.value);

        }
    }

    get value() {
        this._value.children = PhpSymbol.setScope(this._children.toArray(), this._value.name);
        return this._value;
    }

}

class AnonymousFunctionHeaderTransform implements NodeTransform {
    phraseType = PhraseType.AnonymousFunctionHeader;
    value: [SymbolModifier, PhpSymbol[], PhpSymbol[], string];

    constructor() {
        this.value = [0, [], [], ''];
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Ampersand) {
            this.value[0] |= SymbolModifier.Reference;
        } else if (transform.tokenType === TokenType.Static) {
            this.value[0] |= SymbolModifier.Static;
        } else if (transform.phraseType === PhraseType.ParameterDeclarationList) {
            this.value[1] = transform.value;
        } else if (transform.phraseType === PhraseType.AnonymousFunctionUseClause) {
            this.value[2] = transform.value;
        } else if (transform.phraseType === PhraseType.ReturnType) {
            this.value[3] = transform.value;
        }
    }

}

class FunctionDeclarationBodyTransform implements NodeTransform {

    private _value: UniqueSymbolCollection;

    constructor(public phraseType: PhraseType) {
        this._value = new UniqueSymbolCollection();
    }

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.SimpleVariable:
            case PhraseType.AnonymousFunctionCreationExpression:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.FunctionCallExpression:
                this._value.push(transform.value);
                break;
            case undefined:
                //catch clause vars
                if (transform.tokenType === TokenType.VariableName) {
                    this._value.push(transform.value);
                }
            default:
                break;
        }

    }

    get value() {
        return this._value.toArray();
    }

}

class AnonymousFunctionUseClauseTransform implements NodeTransform {

    phraseType = PhraseType.AnonymousFunctionUseClause;
    value: PhpSymbol[];

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.ClosureUseList) {
            this.value = transform.value;
        }
    }

}

class AnonymousFunctionUseVariableTransform implements NodeTransform {

    phraseType = PhraseType.AnonymousFunctionUseVariable;
    value: PhpSymbol;

    constructor(location: Location) {
        this.value = PhpSymbol.create(SymbolKind.Variable, '', location);
        this.value.modifiers = SymbolModifier.Use;
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.VariableName) {
            this.value.name = transform.value;
        } else if (transform.tokenType === TokenType.Ampersand) {
            this.value.modifiers |= SymbolModifier.Reference;
        }
    }

}

class InterfaceDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.InterfaceDeclaration;
    private _value: PhpSymbol;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Interface, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._value, doc, docLocation, nameResolver);
        this._value.children = [];
        this._value.associated = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.InterfaceDeclarationHeader) {
            let v = transform.value as [string, PhpSymbol[]];
            this._value.name = this.nameResolver.resolveRelative(v[0]);
            this._value.associated = v[1];
        } else if (transform.phraseType === PhraseType.InterfaceDeclarationBody) {
            let v = transform.value as [PhpSymbol[], PhpSymbol[]];
            Array.prototype.push.apply(this._value.children, v[0])
            Array.prototype.push.apply(this._value.associated, v[1]);
        }
    }

    get value() {
        PhpSymbol.setScope(this._value.children, this._value.name);
        return this._value;
    }

}

class ConstElementTransform implements NodeTransform {

    phraseType = PhraseType.ConstElement;
    private _value: PhpSymbol;
    private _doc: PhpDoc;
    private _docLocation: Location;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Constant, '', location);
        this._value.scope = this.nameResolver.namespace;
        this._doc = doc;
        this._docLocation = docLocation;
    }

    push(transform: NodeTransform) {

        if (transform.tokenType === TokenType.Name) {
            this._value.name = this.nameResolver.resolveRelative(transform.value);
        } else if (
            transform.tokenType !== TokenType.Whitespace &&
            transform.tokenType !== TokenType.Comment &&
            transform.tokenType !== TokenType.DocumentComment &&
            transform.tokenType !== TokenType.Equals
        ) {
            this._value.value = transform.value;
        }

    }

    get value() {
        return SymbolReader.assignPhpDocInfoToSymbol(this._value, this._doc, this._docLocation, this.nameResolver);
    }

}

class TraitDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.TraitDeclaration;
    private _value: PhpSymbol;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Trait, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._value, doc, docLocation, nameResolver);
        this._value.children = [];
        this._value.associated = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.TraitDeclarationHeader) {
            this._value.name = this.nameResolver.resolveRelative(transform.value);
        } else if (transform.phraseType === PhraseType.TraitDeclarationBody) {
            let v = transform.value as [PhpSymbol[], PhpSymbol[]];
            Array.prototype.push.apply(this._value.children, v[0])
            Array.prototype.push.apply(this._value.associated, v[1]);
        }
    }

    get value() {
        PhpSymbol.setScope(this._value.children, this.value.name);
        return this._value;
    }

}

class TraitDeclarationHeaderTransform implements NodeTransform {

    value = '';
    phraseType = PhraseType.TraitDeclarationHeader;

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value = transform.value;
        }
    }

}

class InterfaceBaseClauseTransform implements NodeTransform {

    value: PhpSymbol[];
    phraseType = PhraseType.InterfaceBaseClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.QualifiedNameList) {
            let v = transform.value as string[];
            for (let n = 0; n < v.length; ++n) {
                this.value.push(PhpSymbol.create(SymbolKind.Interface, v[n]));
            }
        }
    }

}

class InterfaceDeclarationHeaderTransform implements NodeTransform {

    value: [string, PhpSymbol[]];
    phraseType = PhraseType.InterfaceDeclarationHeader;

    constructor() {
        this.value = ['', []];
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name) {
            this.value[0] = transform.value;
        } else if (transform.phraseType === PhraseType.InterfaceBaseClause) {
            this.value[1] = transform.value;
        }
    }

}

class TraitUseClauseTransform implements NodeTransform {

    value: PhpSymbol[];
    PhraseType = PhraseType.TraitUseClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.QualifiedNameList) {
            let tVal = transform.value as string[];
            for (let n = 0, l = tVal.length; n < l; ++n) {
                this.value.push(PhpSymbol.create(SymbolKind.Trait, tVal[n]));
            }
        }
    }

}

class ClassInterfaceClauseTransform implements NodeTransform {
    value: PhpSymbol[];
    phraseType = PhraseType.ClassInterfaceClause;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType !== PhraseType.QualifiedNameList) {
            return;
        }

        for (let n = 0; n < transform.value.length; ++n) {
            this.value.push(PhpSymbol.create(SymbolKind.Interface, transform.value[n]));
        }
    }
}

class QualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.QualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveNotFullyQualified(transform.value);
        }
    }

}

class RelativeQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.RelativeQualifiedName;

    constructor(public nameResolver: NameResolver) { }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = this.nameResolver.resolveRelative(transform.value);
        }
    }

}

class FullyQualifiedNameTransform implements NodeTransform {

    value: string;
    phraseType = PhraseType.FullyQualifiedName;

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value = transform.value;
        }
    }

}

class NamespaceDefinitionTransform implements NodeTransform {

    value: PhpSymbol;
    phraseType = PhraseType.NamespaceDefinition;

    constructor(location: Location) {
        this.value = PhpSymbol.create(SymbolKind.Namespace, '', location);
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.NamespaceName) {
            this.value.name = transform.value;
        }
    }

}

class NamespaceNameTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceName;
    value: string = '';

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Name || transform.tokenType === TokenType.Backslash) {
            this.value += transform.value;
        }
    }

}

class ClassDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.ClassDeclaration;
    private _value: PhpSymbol;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Class, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._value, doc, docLocation, nameResolver);
        this._value.children = [];
        this._value.associated = [];
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.ClassDeclarationHeader) {
            let v = transform.value as [SymbolModifier, string, PhpSymbol, PhpSymbol[]];
            this._value.modifiers = v[0];
            this._value.name = this.nameResolver.resolveRelative(v[1]);
            if (v[2]) {
                this._value.associated.push(v[2]);
            }
            Array.prototype.push.apply(this._value.associated, v[3]);
        } else if (transform.phraseType === PhraseType.ClassDeclarationBody) {
            let v = transform.value as [PhpSymbol[], PhpSymbol[]];
            Array.prototype.push.apply(this._value.children, v[0])
            Array.prototype.push.apply(this._value.associated, v[1]);
        }

    }

    get value() {
        PhpSymbol.setScope(this._value.children, this._value.name);
        return this._value;
    }

}

class ClassDeclarationHeaderTransform implements NodeTransform {

    value: [SymbolModifier, string, PhpSymbol, PhpSymbol[]];
    phraseType = PhraseType.ClassDeclarationHeader;

    constructor() {
        this.value = [0, '', undefined, []];
    }

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.ClassModifiers:
                this.value[0] = transform.value;
                break;

            case PhraseType.ClassBaseClause:
                this.value[2] = transform.value;
                break;

            case PhraseType.ClassInterfaceClause:
                this.value[3] = transform.value;
                break;

            case undefined:
                if (transform.tokenType === TokenType.Name) {
                    this.value[1] = transform.value;
                }
                break;

            default:
                break;

        }
    }

}

class ClassBaseClauseTransform implements NodeTransform {

    value: PhpSymbol;
    phraseType = PhraseType.ClassBaseClause;

    constructor() {
        this.value = PhpSymbol.create(SymbolKind.Class, '');
    }

    push(transform: NodeTransform) {
        if (
            transform.phraseType === PhraseType.FullyQualifiedName ||
            transform.phraseType === PhraseType.RelativeQualifiedName ||
            transform.phraseType === PhraseType.QualifiedName
        ) {
            this.value.name = transform.value;
        }
    }

}

class QualifiedNameListTransform implements NodeTransform {

    value: string[];
    phraseType = PhraseType.QualifiedNameList;

    constructor() {
        this.value = [];
    }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.FullyQualifiedName:
            case PhraseType.QualifiedName:
            case PhraseType.RelativeQualifiedName:
                this.value.push(transform.value);
                break;
            default:
                break;
        }
    }

}

class MemberModifierListTransform implements NodeTransform {

    value: SymbolModifier = SymbolModifier.None;
    phraseType = PhraseType.MemberModifierList;

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Public:
                this.value |= SymbolModifier.Public;
                break;
            case TokenType.Protected:
                this.value |= SymbolModifier.Protected;
                break;
            case TokenType.Private:
                this.value |= SymbolModifier.Private;
                break;
            case TokenType.Abstract:
                this.value |= SymbolModifier.Abstract;
                break;
            case TokenType.Final:
                this.value |= SymbolModifier.Final;
                break;
            case TokenType.Static:
                this.value |= SymbolModifier.Static;
                break;
            default:
                break;
        }
    }

}

class ClassConstantElementTransform implements NodeTransform {

    private _value: PhpSymbol;
    private _docLocation: Location;
    private _doc: PhpDoc;
    phraseType = PhraseType.ClassConstElement;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.ClassConstant, '', location);
        this._doc = doc;
        this._docLocation = docLocation;
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.Identifier) {
            this._value.name = transform.value;
        } else if (
            transform.tokenType !== TokenType.Equals &&
            transform.tokenType !== TokenType.Whitespace &&
            transform.tokenType !== TokenType.Comment &&
            transform.tokenType !== TokenType.DocumentComment
        ) {
            this._value.value = transform.value;
        }
    }

    get value() {
        return SymbolReader.assignPhpDocInfoToSymbol(this._value, this._doc, this._docLocation, this.nameResolver);
    }

}

class DelimiteredListTransform implements NodeTransform {

    value: any[];

    constructor(public phraseType: PhraseType, public delimiter: TokenType) {
        this.value = [];
    }

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Comment:
            case TokenType.DocumentComment:
            case TokenType.Whitespace:
            case this.delimiter:
                break;
            default:
                this.value.push(transform.value);
                break;
        }
    }

}

class MethodDeclarationTransform implements NodeTransform {

    private _value: PhpSymbol;
    phraseType = PhraseType.MethodDeclaration;
    private _children: UniqueSymbolCollection;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Method, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._value, doc, docLocation, nameResolver);
        this._children = new UniqueSymbolCollection();
    }

    push(transform: NodeTransform) {

        if (transform.phraseType === PhraseType.MethodDeclarationHeader) {
            let v = transform.value as [SymbolModifier, string, PhpSymbol[], string];
            this._value.modifiers = v[0] || SymbolModifier.Public;
            this._value.name = this.nameResolver.resolveRelative(v[1]);
            UniqueSymbolCollection.prototype.push.apply(this._children, v[2]);
            this._value.type = v[3];
        } else if (transform.phraseType === PhraseType.MethodDeclarationBody) {
            UniqueSymbolCollection.prototype.push.apply(this._children, transform.value);
        }

    }

    get value() {
        this._value.children = PhpSymbol.setScope(this._children.toArray(), this._value.name);
        return this._value;
    }

}

class ReturnTypeTransform implements NodeTransform {

    value = '';
    phraseType = PhraseType.ReturnType;

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.TypeDeclaration) {
            this.value = transform.value;
        }
    }

}

class TypeDeclarationTransform implements NodeTransform {

    private static _scalarTypes = ['int', 'string', 'bool', 'float', 'iterable'];
    phraseType = PhraseType.TypeDeclaration;
    value = '';

    push(transform: NodeTransform) {

        switch (transform.phraseType) {
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
            case PhraseType.QualifiedName:
                this.value = transform.value;
                if (TypeDeclarationTransform._scalarTypes.indexOf(PhpSymbol.notFqn(this.value).toLowerCase()) > -1) {
                    this.value = PhpSymbol.notFqn(this.value);
                }
                break;

            case undefined:
                if (transform.tokenType === TokenType.Callable || transform.tokenType === TokenType.Array) {
                    this.value = transform.value;
                }
                break;

            default:
                break;
        }

    }

}

class MethodDeclarationHeaderTransform implements NodeTransform {

    value: [SymbolModifier, string, PhpSymbol[], string];
    phraseType = PhraseType.MethodDeclarationHeader;

    constructor() {
        this.value = [0, '', [], ''];
    }

    push(transform: NodeTransform) {
        switch (transform.phraseType) {
            case PhraseType.MemberModifierList:
                this.value[0] = transform.value;
                break;
            case PhraseType.Identifier:
                this.value[1] = transform.value;
                break;
            case PhraseType.ParameterDeclarationList:
                this.value[2] = transform.value;
                break;
            case PhraseType.ReturnType:
                this.value[3] = transform.value;
                break;
            default:
                break;
        }
    }

}

class PropertyInitialiserTransform implements NodeTransform {

    value: string = '';
    phraseType = PhraseType.PropertyInitialiser;

    push(transform: NodeTransform) {
        switch (transform.tokenType) {
            case TokenType.Comment:
            case TokenType.Whitespace:
            case TokenType.DocumentComment:
            case TokenType.Equals:
                break;
            default:
                this.value = transform.value;
                break;
        }
    }

}

class PropertyElementTransform implements NodeTransform {

    private _value: PhpSymbol;
    private _doc: PhpDoc;
    private _docLocation: Location;
    phraseType = PhraseType.PropertyElement;

    constructor(public nameResolver: NameResolver, location: Location, doc: PhpDoc, docLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Property, '', location);
        this._doc = doc;
        this._docLocation = docLocation;
    }

    push(transform: NodeTransform) {

        if (transform.tokenType === TokenType.VariableName) {
            this._value.name = transform.value;
        } else if (transform.phraseType === PhraseType.PropertyInitialiser) {
            this._value.value = transform.value;
        }

    }

    get value() {
        return SymbolReader.assignPhpDocInfoToSymbol(this._value, this._doc, this._docLocation, this.nameResolver);
    }

}

class FieldDeclarationTransform implements NodeTransform {

    private _modifier: SymbolModifier = 0;
    value: PhpSymbol[];

    constructor(
        public phraseType: PhraseType,
        public elementListPhraseType: PhraseType
    ) {
        this.value = [];
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.MemberModifierList) {
            this._modifier = transform.value;
        } else if (transform.phraseType === this.elementListPhraseType) {
            this.value = transform.value as PhpSymbol[];
            let modifier = this._modifier > 0 ? this._modifier : SymbolModifier.Public;
            for (let n = 0; n < this.value.length; ++n) {
                this.value[n].modifiers = modifier;
            }
        }
    }

}

class FunctionDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.FunctionDeclaration;
    private _value: PhpSymbol;
    private _children: UniqueSymbolCollection;

    constructor(public nameResolver: NameResolver, location: Location, phpDoc: PhpDoc, phpDocLocation: Location) {
        this._value = PhpSymbol.create(SymbolKind.Function, '', location);
        SymbolReader.assignPhpDocInfoToSymbol(this._value, phpDoc, phpDocLocation, nameResolver);
        this._children = new UniqueSymbolCollection();
    }

    push(transform: NodeTransform) {
        if (transform.phraseType === PhraseType.FunctionDeclarationHeader) {
            let v = transform.value as [string, PhpSymbol[], string];
            this._value.name = this.nameResolver.resolveRelative(v[0]);
            UniqueSymbolCollection.prototype.push.apply(this._children, v[1]);
            this._value.type = v[2];
        } else if (transform.phraseType === PhraseType.FunctionDeclarationBody) {
            UniqueSymbolCollection.prototype.push.apply(this._children, transform.value);
        }
    }

    get value() {
        this._value.children = PhpSymbol.setScope(this._children.toArray(), this._value.name);
        return this._value;
    }

}

class FunctionDeclarationHeaderTransform implements NodeTransform {

    value: [string, PhpSymbol[], string];
    phraseType = PhraseType.FunctionDeclarationHeader;

    constructor() {
        this.value = ['', [], ''];
    }

    push(transform: NodeTransform) {

        if (transform.tokenType === TokenType.Name) {
            this.value[0] = transform.value;
        } else if (transform.phraseType === PhraseType.ParameterDeclarationList) {
            this.value[1] = transform.value;
        } else if (transform.phraseType === PhraseType.ReturnType) {
            this.value[2] = transform.value;
        }
    }
}

class DefaultNodeTransform implements NodeTransform {

    constructor(public phraseType: PhraseType, public value: string) { }

    push(transform: NodeTransform) { }

}

export namespace SymbolReader {

    export function assignPhpDocInfoToSymbol(s: PhpSymbol, doc: PhpDoc, docLocation: Location, nameResolver: NameResolver) {

        if (!doc) {
            return s;
        }
        let tag: Tag;

        switch (s.kind) {
            case SymbolKind.Property:
            case SymbolKind.ClassConstant:
                tag = doc.findVarTag(s.name);
                if (tag) {
                    s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, nameResolver));
                }
                break;

            case SymbolKind.Method:
            case SymbolKind.Function:
                tag = doc.returnTag;
                s.doc = PhpSymbolDoc.create(doc.text);
                if (tag) {
                    s.doc.type = TypeString.nameResolve(tag.typeString, nameResolver);
                }
                break;

            case SymbolKind.Parameter:
                tag = doc.findParamTag(s.name);
                if (tag) {
                    s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, nameResolver));
                }
                break;

            case SymbolKind.Class:
            case SymbolKind.Trait:
            case SymbolKind.Interface:
                s.doc = PhpSymbolDoc.create(doc.text);
                if (!s.children) {
                    s.children = [];
                }
                Array.prototype.push.apply(s.children, phpDocMembers(doc, docLocation, nameResolver));
                break;

            default:
                break;

        }

        return s;

    }

    export function phpDocMembers(phpDoc: PhpDoc, phpDocLoc: Location, nameResolver: NameResolver) {

        let magic: Tag[] = phpDoc.propertyTags;
        let symbols: PhpSymbol[] = [];

        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(propertyTagToSymbol(magic[n], phpDocLoc, nameResolver));
        }

        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(methodTagToSymbol(magic[n], phpDocLoc, nameResolver));
        }

        return symbols;
    }

    function methodTagToSymbol(tag: Tag, phpDocLoc: Location, nameResolver: NameResolver) {

        let s = PhpSymbol.create(SymbolKind.Method, tag.name, phpDocLoc);
        s.modifiers = SymbolModifier.Magic | SymbolModifier.Public;
        s.doc = PhpSymbolDoc.create(tag.description, TypeString.nameResolve(tag.typeString, nameResolver));
        s.children = [];

        if (!tag.parameters) {
            return s;
        }

        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc, nameResolver));
        }

        return s;
    }

    function magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc: Location, nameResolver: NameResolver) {

        let s = PhpSymbol.create(SymbolKind.Parameter, p.name, phpDocLoc);
        s.modifiers = SymbolModifier.Magic;
        s.doc = PhpSymbolDoc.create(undefined, TypeString.nameResolve(p.typeString, nameResolver));
        return s;

    }

    function propertyTagToSymbol(t: Tag, phpDocLoc: Location, nameResolver: NameResolver) {
        let s = PhpSymbol.create(SymbolKind.Property, t.name, phpDocLoc);
        s.modifiers = magicPropertyModifier(t) | SymbolModifier.Magic | SymbolModifier.Public;
        s.doc = PhpSymbolDoc.create(t.description, TypeString.nameResolve(t.typeString, nameResolver));
        return s;
    }

    function magicPropertyModifier(t: Tag) {
        switch (t.tagName) {
            case '@property-read':
                return SymbolModifier.ReadOnly;
            case '@property-write':
                return SymbolModifier.WriteOnly;
            default:
                return SymbolModifier.None;
        }
    }

    export function modifierListElementsToSymbolModifier(tokens: Token[]) {

        let flag = SymbolModifier.None;
        if (!tokens || tokens.length < 1) {
            return flag;
        }

        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= this.modifierTokenToSymbolModifier(tokens[n]);
        }

        return flag;
    }

    export function modifierTokenToSymbolModifier(t: Token) {
        switch (t.tokenType) {
            case TokenType.Public:
                return SymbolModifier.Public;
            case TokenType.Protected:
                return SymbolModifier.Protected;
            case TokenType.Private:
                return SymbolModifier.Private;
            case TokenType.Abstract:
                return SymbolModifier.Abstract;
            case TokenType.Final:
                return SymbolModifier.Final;
            case TokenType.Static:
                return SymbolModifier.Static;
            default:
                return SymbolModifier.None;
        }

    }

}