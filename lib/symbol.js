/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("./types");
const phpDoc_1 = require("./phpDoc");
const parsedDocument_1 = require("./parsedDocument");
const util = require("./util");
var PhpSymbol;
(function (PhpSymbol) {
    function acronym(s) {
        let text = s.name.slice(s.name.lastIndexOf('\\') + 1);
        if (!text) {
            return '';
        }
        let lcText = text.toLowerCase();
        let n = 0;
        let l = text.length;
        let c;
        let acronym = lcText[0] !== '_' && lcText[0] !== '$' ? lcText[0] : '';
        while (n < l) {
            c = text[n];
            if ((c === '$' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                acronym += lcText[n];
            }
            else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                acronym += lcText[n];
            }
            ++n;
        }
        return acronym;
    }
    PhpSymbol.acronym = acronym;
    /**
     * Get suffixes after $, namespace separator, underscore and on lowercase uppercase boundary
     */
    function suffixArray(s) {
        if (!s.name) {
            return [];
        }
        let text = s.name;
        let lcText = text.toLowerCase();
        let suffixes = [lcText];
        let n = 0;
        let c;
        let l = text.length;
        while (n < l) {
            c = text[n];
            if ((c === '$' || c === '\\' || c === '_') && n + 1 < l && text[n + 1] !== '_') {
                ++n;
                suffixes.push(lcText.slice(n));
            }
            else if (n > 0 && c !== lcText[n] && text[n - 1] === lcText[n - 1]) {
                //uppercase
                suffixes.push(lcText.slice(n));
            }
            ++n;
        }
        return suffixes;
    }
    PhpSymbol.suffixArray = suffixArray;
})(PhpSymbol = exports.PhpSymbol || (exports.PhpSymbol = {}));
class NameResolver {
    constructor(document, importedSymbols, namespaceName, thisName, thisBaseName) {
        this.document = document;
        this.importedSymbols = importedSymbols;
        this.namespaceName = namespaceName;
        this.thisName = thisName;
        this.thisBaseName = thisBaseName;
    }
    resolveRelative(relativeName) {
        if (!relativeName) {
            return '';
        }
        return this.namespaceName ? this.namespaceName + '\\' + relativeName : relativeName;
    }
    resolveNotFullyQualified(notFqName, kind) {
        if (!notFqName) {
            return '';
        }
        if (notFqName === 'self' || notFqName === 'static') {
            return this.thisName;
        }
        let pos = notFqName.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqName, kind) :
            this._resolveQualified(name, pos);
    }
    namespaceNameText(node, endOffset) {
        if (!node || !node.parts || node.parts.length < 1) {
            return '';
        }
        let parts = [];
        let t;
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            t = node.parts[n];
            if (endOffset && parsedDocument_1.ParsedDocument.isOffsetInToken(endOffset, t)) {
                parts.push(this.document.tokenText(t).substr(0, endOffset + 1 - t.offset));
                break;
            }
            parts.push(this.document.tokenText(node.parts[n]));
        }
        return parts.join('\\');
    }
    qualifiedNameText(node, kind) {
        if (!node || !node.name) {
            return '';
        }
        let name = this.namespaceNameText(node.name);
        switch (node.phraseType) {
            case 139 /* QualifiedName */:
                return this.resolveNotFullyQualified(name, kind);
            case 142 /* RelativeQualifiedName */:
                return this.resolveRelative(name);
            case 83 /* FullyQualifiedName */:
            default:
                return name;
        }
    }
    tokenText(t, endOffset) {
        let text = this.document.tokenText(t).slice();
        if (endOffset) {
            text = text.substr(0, endOffset + 1 - t.offset);
        }
        return text;
    }
    _matchImportedSymbol(text, kind) {
        let s;
        for (let n = 0, l = this.importedSymbols.length; n < l; ++n) {
            s = this.importedSymbols[n];
            if (s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }
    _resolveQualified(name, pos) {
        let s = this._matchImportedSymbol(name.slice(0, pos), 1 /* Class */);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }
    _resolveUnqualified(name, kind) {
        let s = this._matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }
}
exports.NameResolver = NameResolver;
class TypeString {
    constructor(text) {
        this._parts = text ? this._chunk(text) : [];
    }
    isEmpty() {
        return this._parts.length < 1;
    }
    atomicClassArray() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part[part.length - 1] !== ']' && TypeString._keywords.indexOf(part) < 0) {
                parts.push(part);
            }
        }
        return parts;
    }
    arrayDereference() {
        let parts = [];
        let part;
        for (let n = 0; n < this._parts.length; ++n) {
            part = this._parts[n];
            if (part.slice(-2) === '[]') {
                part = part.slice(0, -2);
                if (part.slice(-1) === ')') {
                    part = part.slice(1, -1);
                    Array.prototype.push.apply(parts, this._chunk(part));
                    parts = this._unique(parts);
                }
                else {
                    parts.push(part);
                }
            }
        }
        let typeString = new TypeString(null);
        typeString._parts = parts;
        return typeString;
    }
    array() {
        let text;
        if (this._parts.length > 1) {
            text = '(' + this.toString() + ')[]';
        }
        else {
            text = this._parts[0] + '[]';
        }
        return new TypeString(text);
    }
    merge(type) {
        let parts = util.isString(type) ? this._chunk(type) : type._parts;
        Array.prototype.push.apply(parts, this._parts);
        let newTypeString = new TypeString(null);
        newTypeString._parts = this._unique(parts);
        return newTypeString;
    }
    nameResolve(nameResolver) {
        let replacer = (match, offset, text) => {
            if (TypeString._keywords.indexOf(match[0]) >= 0) {
                return match[0];
            }
            else if (match[0] === '\\') {
                return match.slice(1);
            }
            else {
                return nameResolver.resolveNotFullyQualified(match, 1 /* Class */);
            }
        };
        return new TypeString(this._parts.join('|').replace(TypeString._classNamePattern, replacer));
    }
    toString() {
        return this._parts.join('|');
    }
    _unique(parts) {
        let map = {};
        let part;
        for (let n = 0; n < parts.length; ++n) {
            part = parts[n];
            map[part] = part;
        }
        return Object.keys(map);
    }
    _chunk(typeString) {
        let n = 0;
        let parentheses = 0;
        let parts = [];
        let part = '';
        let c;
        while (n < typeString.length) {
            c = typeString[n];
            switch (c) {
                case '|':
                    if (parentheses) {
                        part += c;
                    }
                    else if (part) {
                        parts.push(part);
                        part = '';
                    }
                    break;
                case '(':
                    ++parentheses;
                    part += c;
                    break;
                case ')':
                    --parentheses;
                    part += c;
                    break;
                default:
                    part += c;
                    break;
            }
            ++n;
        }
        if (part) {
            parts.push(part);
        }
        return parts;
    }
}
TypeString._classNamePattern = /([\\a-zA-Z_\x7f-\xff][\\a-zA-Z0-9_\x7f-\xff])*/g;
TypeString._keywords = [
    'string', 'integer', 'int', 'boolean', 'bool', 'float',
    'double', 'object', 'mixed', 'array', 'resource',
    'void', 'null', 'callback', 'false', 'true', 'self',
    'callable'
];
exports.TypeString = TypeString;
/*
export class SymbolTree {

    static parametersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Parameter;
    };

    static closureUseVariablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable &&
            (x.value.modifiers & SymbolModifier.Use) > 0;
    };

    static variablesPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return x.value.kind === SymbolKind.Variable;
    };

    static instanceExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static instanceInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property || x.value.kind === SymbolKind.Method) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            !(x.value.modifiers & SymbolModifier.Static);
    }

    static staticInternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticExternalMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & SymbolModifier.Public) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static staticInheritedMembersPredicate: Predicate<Tree<PhpSymbol>> = (x) => {
        return (x.value.kind === SymbolKind.Property ||
            x.value.kind === SymbolKind.Method ||
            x.value.kind === SymbolKind.Constant) &&
            (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
            (x.value.modifiers & SymbolModifier.Static) > 0;
    }

    static parameters(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.parametersPredicate);
    }

    static closureUseVariables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.closureUseVariablesPredicate);
    }

    static variables(node: Tree<PhpSymbol>) {
        return node.children.filter(SymbolTree.variablesPredicate);
    }

}
*/
class SymbolTable {
    constructor(uri, root) {
        this.uri = uri;
        this.root = root;
    }
    get symbols() {
        let traverser = new types_1.TreeTraverser([this.root]);
        let symbols = traverser.toArray();
        //remove root
        symbols.shift();
        return symbols;
    }
    get count() {
        let traverser = new types_1.TreeTraverser([this.root]);
        //subtract 1 for root
        return traverser.count() - 1;
    }
    filter(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.filter(predicate);
    }
    find(predicate) {
        let traverser = new types_1.TreeTraverser([this.root]);
        return traverser.find(predicate);
    }
    static create(parsedDocument) {
        let symbolReader = new SymbolReader(parsedDocument, new NameResolver(parsedDocument, [], '', '', ''), [{ kind: 0 /* None */, name: '', children: [] }]);
        parsedDocument.traverse(symbolReader);
        return new SymbolTable(parsedDocument.uri, symbolReader.spine[0]);
    }
}
exports.SymbolTable = SymbolTable;
class SymbolStore {
    constructor() {
        this.onParsedDocumentChange = (args) => {
            this.remove(args.parsedDocument.uri);
            this.add(SymbolTable.create(args.parsedDocument));
        };
        this._map = {};
        this._index = new SymbolIndex();
        this._symbolCount = 0;
    }
    getSymbolTable(uri) {
        return this._map[uri];
    }
    get tableCount() {
        return Object.keys(this._map).length;
    }
    get symbolCount() {
        return this._symbolCount;
    }
    add(symbolTable) {
        if (this.getSymbolTable(symbolTable.uri)) {
            throw new Error(`Duplicate key ${symbolTable.uri}`);
        }
        this._map[symbolTable.uri] = symbolTable;
        this._index.addMany(this._indexSymbols(symbolTable.root));
        this._symbolCount += symbolTable.count;
    }
    remove(uri) {
        let symbolTable = this.getSymbolTable(uri);
        if (!symbolTable) {
            return;
        }
        this._index.removeMany(this._indexSymbols(symbolTable.root));
        this._symbolCount -= symbolTable.count;
        delete this._map[uri];
    }
    /**
     * As per match but returns first item in result
     * @param text
     * @param kindMask
     */
    find(text, filter) {
        return this.match(text, filter).shift();
    }
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text, filter) {
        if (!text) {
            return [];
        }
        let matched = this._index.match(text);
        if (!filter) {
            return matched;
        }
        let filtered = [];
        let s;
        for (let n = 0, l = matched.length; n < l; ++n) {
            s = matched[n];
            if (filter(s)) {
                filtered.push(s);
            }
        }
        return filtered;
    }
    _classOrInterfaceFilter(s) {
        return (s.kind & (1 /* Class */ | 2 /* Interface */)) > 0;
    }
    lookupTypeMembers(typeName, memberPredicate) {
        let type = this.match(typeName, this._classOrInterfaceFilter).shift();
        return this._lookupTypeMembers(type, memberPredicate);
    }
    lookupTypeMember(typeName, memberPredicate) {
        return this.lookupTypeMembers(typeName, memberPredicate).shift();
    }
    _lookupTypeMembers(type, predicate) {
        if (!type) {
            return [];
        }
        let members = type.children.filter(predicate);
        let associated = [];
        let associatedKindMask = 1 /* Class */ ? 1 /* Class */ | 4 /* Trait */ : 2 /* Interface */;
        let baseSymbol;
        if (type.associated) {
            for (let n = 0, l = type.associated.length; n < l; ++n) {
                baseSymbol = type.associated[n];
                if ((baseSymbol.kind & associatedKindMask) > 0 && baseSymbol.name) {
                    associated.push(baseSymbol);
                }
            }
        }
        //lookup in base class/traits
        let basePredicate = (x) => {
            return predicate(x) && !(x.modifiers & 4 /* Private */);
        };
        for (let n = 0, l = associated.length; n < l; ++n) {
            baseSymbol = associated[n];
            baseSymbol = this.match(baseSymbol.name, (x) => {
                return x.kind === baseSymbol.kind;
            }).shift();
            if (baseSymbol) {
                Array.prototype.push.apply(members, this._lookupTypeMembers(baseSymbol, basePredicate));
            }
        }
        return members;
    }
    _indexSymbols(root) {
        let traverser = new types_1.TreeTraverser([root]);
        return traverser.filter(this._indexFilter);
    }
    _indexFilter(s) {
        return s.kind !== 128 /* Parameter */ &&
            (s.kind !== 256 /* Variable */ || !s.scope) &&
            s.name.length > 0;
    }
}
exports.SymbolStore = SymbolStore;
/*

interface ResolvedVariable {
    name: string;
    type: TypeString;
}

const enum VariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface VariableSet {
    kind: VariableSetKind;
    vars: { [index: string]: ResolvedVariable };
}


export class VariableTable {

    private _node: Tree<VariableSet>;
    private _thisTypeStack: TypeString[];

    constructor() {
        this._node = new Tree<VariableSet>({
            kind: VariableSetKind.Scope,
            vars: {}
        });
        this._thisTypeStack = [];
    }

    setType(varName: string, type: TypeString) {
        this._node.value.vars[varName] = { name: varName, type: type };
    }

    pushThisType(thisType: TypeString) {
        this._thisTypeStack.push(thisType);
    }

    popThisType() {
        this._thisTypeStack.pop();
    }

    pushScope(carry: string[] = null) {

        let resolvedVariables: ResolvedVariable[] = [];
        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    resolvedVariables.push({ name: carry[n], type: type });
                }
            }
        }

        this._pushNode(VariableSetKind.Scope);
        for (let n = 0; n < resolvedVariables.length; ++n) {
            this.setType(resolvedVariables[n].name, resolvedVariables[n].type);
        }
    }

    popScope() {
        this._node = this._node.parent;
    }

    pushBranch() {
        this._pushNode(VariableSetKind.Branch);
    }

    popBranch() {
        this._node = this._node.parent;
    }

    pushBranchGroup() {
        this._pushNode(VariableSetKind.BranchGroup);
    }

    popBranchGroup() {

        //can consolidate variables and prune tree as at this point
        //each variable may be any of types discovered in branches
        let b = this._node;
        this._node = b.parent;
        let consolidator = new TypeConsolidator(this._node.value.vars);
        b.traverse(consolidator);
        this._node.removeChild(b);

    }

    getType(varName: string) {

        let type: TypeString;
        let vars: { [index: string]: ResolvedVariable };
        let node = this._node;

        if (varName === '$this') {
            return util.top<TypeString>(this._thisTypeStack);
        }

        while (node) {

            if (node.value.vars.hasOwnProperty(varName)) {
                return node.value.vars[varName].type;
            } else if (node.value.kind !== VariableSetKind.Scope) {
                node = node.parent;
            } else {
                break;
            }

        }

        return null;

    }

    private _pushNode(kind: VariableSetKind) {
        let node = new Tree<VariableSet>({
            kind: kind,
            vars: {}
        });
        this._node = this._node.addChild(node);
    }

}

class TypeConsolidator implements TreeVisitor<VariableSet> {

    constructor(public variables: { [index: string]: ResolvedVariable }) {

    }

    preOrder(node: Tree<VariableSet>) {

        let keys = Object.keys(node.value.vars);
        let v: ResolvedVariable;
        let key: string;

        for (let n = 0; n < keys.length; ++n) {
            key = keys[n];
            v = node.value.vars[key];

            if (this.variables.hasOwnProperty(key)) {
                this.variables[key].type = this.variables[key].type.merge(v.type);
            } else {
                this.variables[key] = v;
            }
        }

        return true;

    }

}

*/
class SymbolReader {
    constructor(parsedDocument, nameResolver, spine) {
        this.parsedDocument = parsedDocument;
        this.nameResolver = nameResolver;
        this.spine = spine;
    }
    preOrder(node, spine) {
        let s;
        switch (node.phraseType) {
            case 118 /* NamespaceDefinition */:
                s = this.namespaceDefinition(node);
                this.nameResolver.namespaceName = s.name;
                this._addSymbol(s, false);
                return true;
            case 122 /* NamespaceUseDeclaration */:
                [this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix] =
                    this.namespaceUseDeclaration(node);
                return true;
            case 120 /* NamespaceUseClause */:
                s = this.namespaceUseClause(node, this.namespaceUseDeclarationKind, this.namespaceUseDeclarationPrefix);
                this._addSymbol(s, false);
                if (s.associated && s.associated.length > 0 && s.name) {
                    this.nameResolver.importedSymbols.push(s);
                }
                return false;
            case 43 /* ConstElement */:
                this._addSymbol(this.constElement(node, this.lastPhpDoc), false);
                return false;
            case 85 /* FunctionDeclaration */:
                this._addSymbol(this.functionDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 86 /* FunctionDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    this.functionDeclarationHeader(node);
                return true;
            case 127 /* ParameterDeclaration */:
                this._addSymbol(this.parameterDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 171 /* TypeDeclaration */:
                s = this.spine[this.spine.length - 1];
                let typeDeclarationValue = this.typeDeclaration(node);
                s.type = s.type ? s.type.merge(typeDeclarationValue) : new TypeString(typeDeclarationValue);
                return false;
            case 28 /* ClassDeclaration */:
                this._addSymbol(this.classDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 30 /* ClassDeclarationHeader */:
                this.classDeclarationHeader(this.spine[this.spine.length - 1], node);
                return true;
            case 23 /* ClassBaseClause */:
                s = this.spine[this.spine.length - 1];
                let classBaseClause = this.classBaseClause(node);
                if (s.associated) {
                    s.associated.push(classBaseClause);
                }
                else {
                    s.associated = [classBaseClause];
                }
                return false;
            case 31 /* ClassInterfaceClause */:
                s = this.spine[this.spine.length - 1];
                let classInterfaceClause = this.classInterfaceClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, classInterfaceClause);
                }
                else {
                    s.associated = classInterfaceClause;
                }
                return false;
            case 101 /* InterfaceDeclaration */:
                this._addSymbol(this.interfaceDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 103 /* InterfaceDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    this.interfaceDeclarationHeader(node);
                return false;
            case 100 /* InterfaceBaseClause */:
                s = this.spine[this.spine.length - 1];
                let interfaceBaseClause = this.interfaceBaseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, interfaceBaseClause);
                }
                else {
                    s.associated = interfaceBaseClause;
                }
                return false;
            case 163 /* TraitDeclaration */:
                this._addSymbol(this.traitDeclaration(node, this.lastPhpDoc, this.lastPhpDocLocation), true);
                return true;
            case 165 /* TraitDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    this.traitDeclarationHeader(node);
                return false;
            case 25 /* ClassConstDeclaration */:
                this.classConstDeclarationModifier =
                    this.classConstantDeclaration(node);
                return true;
            case 26 /* ClassConstElement */:
                this._addSymbol(this.classConstElement(this.classConstDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 135 /* PropertyDeclaration */:
                this.propertyDeclarationModifier =
                    this.propertyDeclaration(node);
                return true;
            case 136 /* PropertyElement */:
                this._addSymbol(this.propertyElement(this.propertyDeclarationModifier, node, this.lastPhpDoc), false);
                return false;
            case 168 /* TraitUseClause */:
                s = this.spine[this.spine.length - 1];
                let traitUseClause = this.traitUseClause(node);
                if (s.associated) {
                    Array.prototype.push.apply(s.associated, traitUseClause);
                }
                else {
                    s.associated = traitUseClause;
                }
                return false;
            case 111 /* MethodDeclaration */:
                this._addSymbol(this.methodDeclaration(node, this.lastPhpDoc), true);
                return true;
            case 113 /* MethodDeclarationHeader */:
                this.spine[this.spine.length - 1].name =
                    this.methodDeclarationHeader(node);
                return true;
            case 108 /* MemberModifierList */:
                this.spine[this.spine.length - 1].modifiers =
                    this.memberModifierList(node);
                return false;
            case 2 /* AnonymousClassDeclaration */:
                this._addSymbol(this.anonymousClassDeclaration(node), true);
                return true;
            case 4 /* AnonymousFunctionCreationExpression */:
                this._addSymbol(this.anonymousFunctionCreationExpression(node), true);
                return true;
            case 7 /* AnonymousFunctionUseVariable */:
                this._addSymbol(this.anonymousFunctionUseVariable(node), false);
                return false;
            case 154 /* SimpleVariable */:
                s = this.simpleVariable(node);
                if (s && !this._variableExists(s.name)) {
                    this._addSymbol(s, false);
                }
                return false;
            case undefined:
                this._token(node);
                return false;
            default:
                return true;
        }
    }
    postOrder(node, spine) {
        switch (node.phraseType) {
            case 118 /* NamespaceDefinition */:
                if (node.statementList) {
                    this.nameResolver.namespaceName = '';
                }
                break;
            case 85 /* FunctionDeclaration */:
            case 127 /* ParameterDeclaration */:
            case 28 /* ClassDeclaration */:
            case 101 /* InterfaceDeclaration */:
            case 163 /* TraitDeclaration */:
            case 111 /* MethodDeclaration */:
            case 2 /* AnonymousClassDeclaration */:
            case 4 /* AnonymousFunctionCreationExpression */:
                this.spine.pop();
                break;
            default:
                break;
        }
    }
    _variableExists(name) {
        let parent = this.spine[this.spine.length - 1];
        if (!parent.children) {
            return false;
        }
        let mask = 128 /* Parameter */ | 256 /* Variable */;
        let s;
        for (let n = 0, l = parent.children.length; n < l; ++n) {
            s = parent.children[n];
            if ((s.kind & mask) > 0 && s.name === name) {
                return true;
            }
        }
        return false;
    }
    _token(t) {
        switch (t.tokenType) {
            case 160 /* DocumentComment */:
                let phpDocTokenText = this.parsedDocument.tokenText(t);
                this.lastPhpDoc = phpDoc_1.PhpDocParser.parse(phpDocTokenText);
                this.lastPhpDocLocation = {
                    uri: this.parsedDocument.uri,
                    range: {
                        start: this.parsedDocument.positionAtOffset(t.offset),
                        end: this.parsedDocument.positionAtOffset(t.offset + phpDocTokenText.length)
                    }
                };
                break;
            case 119 /* CloseBrace */:
                this.lastPhpDoc = null;
                this.lastPhpDocLocation = null;
                break;
            default:
                break;
        }
    }
    _addSymbol(symbol, pushToSpine) {
        if (!symbol) {
            return;
        }
        let parent = this.spine[this.spine.length - 1];
        if (!parent.children) {
            parent.children = [];
        }
        if (parent.name) {
            symbol.scope = parent.name;
        }
        parent.children.push(symbol);
        if (pushToSpine) {
            this.spine.push(symbol);
        }
    }
    nameTokenToFqn(t) {
        let name = this.parsedDocument.tokenText(t);
        return name ? this.nameResolver.resolveRelative(name) : '';
    }
    phraseLocation(p) {
        if (!p) {
            return null;
        }
        let range = this.parsedDocument.phraseRange(p);
        if (!range) {
            return null;
        }
        return {
            uri: this.parsedDocument.uri,
            range: range
        };
    }
    functionDeclaration(node, phpDoc) {
        let s = {
            kind: 64 /* Function */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    functionDeclarationHeader(node) {
        return this.nameTokenToFqn(node.name);
    }
    parameterDeclaration(node, phpDoc) {
        let s = {
            kind: 128 /* Parameter */,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                let type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
                s.type = s.type ? s.type.merge(type) : type;
            }
        }
        return s;
    }
    typeDeclaration(node) {
        return node.name.phraseType ?
            this.qualifiedName(node.name, 1 /* Class */) :
            this.parsedDocument.tokenText(node.name);
    }
    qualifiedName(node, kind) {
        if (!node || !node.name) {
            return '';
        }
        let name = this.parsedDocument.namespaceNameToString(node.name);
        switch (node.phraseType) {
            case 139 /* QualifiedName */:
                return this.nameResolver.resolveNotFullyQualified(name, kind);
            case 142 /* RelativeQualifiedName */:
                return this.nameResolver.resolveRelative(name);
            case 83 /* FullyQualifiedName */:
            default:
                return name;
        }
    }
    constElement(node, phpDoc) {
        let s = {
            kind: 8 /* Constant */,
            name: this.nameTokenToFqn(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    classConstantDeclaration(node) {
        return node.modifierList ?
            this.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            0 /* None */;
    }
    classConstElement(modifiers, node, phpDoc) {
        let s = {
            kind: 1024 /* ClassConstant */,
            modifiers: modifiers,
            name: this.identifier(node.name),
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    methodDeclaration(node, phpDoc) {
        let s = {
            kind: 32 /* Method */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            let returnTag = phpDoc.returnTag;
            if (returnTag) {
                s.type = new TypeString(returnTag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    memberModifierList(node) {
        return this.modifierListElementsToSymbolModifier(node.elements);
    }
    methodDeclarationHeader(node) {
        return this.identifier(node.name);
    }
    propertyDeclaration(node) {
        return node.modifierList ?
            this.modifierListElementsToSymbolModifier(node.modifierList.elements) :
            0 /* None */;
    }
    propertyElement(modifiers, node, phpDoc) {
        let s = {
            kind: 16 /* Property */,
            name: this.parsedDocument.tokenText(node.name),
            modifiers: modifiers,
            location: this.phraseLocation(node)
        };
        if (phpDoc) {
            let tag = phpDoc.findVarTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = new TypeString(tag.typeString).nameResolve(this.nameResolver);
            }
        }
        return s;
    }
    identifier(node) {
        return this.parsedDocument.tokenText(node.name);
    }
    interfaceDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 2 /* Interface */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    phpDocMembers(phpDoc, phpDocLoc) {
        let magic = phpDoc.propertyTags;
        let symbols = [];
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.propertyTagToSymbol(magic[n], phpDocLoc));
        }
        magic = phpDoc.methodTags;
        for (let n = 0, l = magic.length; n < l; ++n) {
            symbols.push(this.methodTagToSymbol(magic[n], phpDocLoc));
        }
        return symbols;
    }
    methodTagToSymbol(tag, phpDocLoc) {
        let s = {
            kind: 32 /* Method */,
            modifiers: 256 /* Magic */,
            name: tag.name,
            type: new TypeString(tag.typeString).nameResolve(this.nameResolver),
            description: tag.description,
            children: [],
            location: phpDocLoc
        };
        if (!tag.parameters) {
            return s;
        }
        for (let n = 0, l = tag.parameters.length; n < l; ++n) {
            s.children.push(this.magicMethodParameterToSymbol(tag.parameters[n], phpDocLoc));
        }
        return s;
    }
    magicMethodParameterToSymbol(p, phpDocLoc) {
        return {
            kind: 128 /* Parameter */,
            name: p.name,
            modifiers: 256 /* Magic */,
            type: new TypeString(p.typeString).nameResolve(this.nameResolver),
            location: phpDocLoc
        };
    }
    propertyTagToSymbol(t, phpDocLoc) {
        return {
            kind: 16 /* Property */,
            name: t.name,
            modifiers: this.magicPropertyModifier(t) | 256 /* Magic */,
            type: new TypeString(t.typeString).nameResolve(this.nameResolver),
            description: t.description,
            location: phpDocLoc
        };
    }
    magicPropertyModifier(t) {
        switch (t.tagName) {
            case '@property-read':
                return 64 /* ReadOnly */;
            case '@property-write':
                return 128 /* WriteOnly */;
            default:
                return 0 /* None */;
        }
    }
    interfaceDeclarationHeader(node) {
        return this.nameTokenToFqn(node.name);
    }
    interfaceBaseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    traitDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 4 /* Trait */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    traitDeclarationHeader(node) {
        return this.nameTokenToFqn(node.name);
    }
    classDeclaration(node, phpDoc, phpDocLoc) {
        let s = {
            kind: 1 /* Class */,
            name: '',
            location: this.phraseLocation(node),
            children: []
        };
        if (phpDoc) {
            s.description = phpDoc.text;
            Array.prototype.push.apply(s.children, this.phpDocMembers(phpDoc, phpDocLoc));
        }
        return s;
    }
    classDeclarationHeader(s, node) {
        if (node.modifier) {
            s.modifiers = this.modifierTokenToSymbolModifier(node.modifier);
        }
        s.name = this.nameTokenToFqn(node.name);
        return s;
    }
    classBaseClause(node) {
        return {
            kind: 1 /* Class */,
            name: this.qualifiedName(node.name, 1 /* Class */)
        };
    }
    classInterfaceClause(node) {
        let mapFn = (name) => {
            return {
                kind: 2 /* Interface */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    traitUseClause(node) {
        let mapFn = (name) => {
            return {
                kind: 4 /* Trait */,
                name: name
            };
        };
        return this.qualifiedNameList(node.nameList).map(mapFn);
    }
    anonymousClassDeclaration(node) {
        return {
            kind: 1 /* Class */,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.phraseLocation(node)
        };
    }
    anonymousFunctionCreationExpression(node) {
        return {
            kind: 64 /* Function */,
            name: this.parsedDocument.createAnonymousName(node),
            modifiers: 512 /* Anonymous */,
            location: this.phraseLocation(node)
        };
    }
    anonymousFunctionUseVariable(node) {
        return {
            kind: 256 /* Variable */,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
    }
    simpleVariable(node) {
        if (!parsedDocument_1.ParsedDocument.isToken(node.name, [84 /* VariableName */])) {
            return null;
        }
        return {
            kind: 256 /* Variable */,
            name: this.parsedDocument.tokenText(node.name),
            location: this.phraseLocation(node)
        };
    }
    qualifiedNameList(node) {
        let names = [];
        let name;
        if (!node) {
            return names;
        }
        for (let n = 0, l = node.elements.length; n < l; ++n) {
            name = this.qualifiedName(node.elements[n], 1 /* Class */);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }
    modifierListElementsToSymbolModifier(tokens) {
        let flag = 0 /* None */;
        if (!tokens || tokens.length < 1) {
            return flag;
        }
        for (let n = 0, l = tokens.length; n < l; ++n) {
            flag |= this.modifierTokenToSymbolModifier(tokens[n]);
        }
        return flag;
    }
    modifierTokenToSymbolModifier(t) {
        switch (t.tokenType) {
            case 55 /* Public */:
                return 1 /* Public */;
            case 56 /* Protected */:
                return 2 /* Protected */;
            case 54 /* Private */:
                return 4 /* Private */;
            case 2 /* Abstract */:
                return 16 /* Abstract */;
            case 31 /* Final */:
                return 8 /* Final */;
            case 60 /* Static */:
                return 32 /* Static */;
            default:
                return 0 /* None */;
        }
    }
    concatNamespaceName(prefix, name) {
        if (!name) {
            return null;
        }
        else if (!prefix) {
            return name;
        }
        else {
            return prefix + '\\' + name;
        }
    }
    namespaceUseClause(node, kind, prefix) {
        let s = {
            kind: kind ? kind : 1 /* Class */,
            name: node.aliasingClause ? this.parsedDocument.tokenText(node.aliasingClause.alias) : null,
            associated: [],
            location: this.phraseLocation(node)
        };
        let fqn = this.concatNamespaceName(prefix, this.parsedDocument.namespaceNameToString(node.name));
        if (!fqn) {
            return s;
        }
        s.associated.push({ kind: s.kind, name: fqn });
        if (!node.aliasingClause) {
            s.name = fqn.split('\\').pop();
        }
        return s;
    }
    tokenToSymbolKind(t) {
        switch (t.tokenType) {
            case 35 /* Function */:
                return 64 /* Function */;
            case 12 /* Const */:
                return 8 /* Constant */;
            default:
                return 0 /* None */;
        }
    }
    namespaceUseDeclaration(node) {
        return [
            node.kind ? this.tokenToSymbolKind(node.kind) : 0 /* None */,
            node.prefix ? this.parsedDocument.namespaceNameToString(node.prefix) : null
        ];
    }
    namespaceDefinition(node) {
        return {
            kind: 512 /* Namespace */,
            name: this.parsedDocument.namespaceNameToString(node.name),
            location: this.phraseLocation(node),
            children: []
        };
    }
}
exports.SymbolReader = SymbolReader;
class SymbolIndex {
    constructor() {
        this._nodeArray = [];
        this._binarySearch = new types_1.BinarySearch(this._nodeArray);
        this._collator = new Intl.Collator('en');
    }
    add(item) {
        let suffixes = this._symbolSuffixes(item);
        let node;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (node) {
                node.items.push(item);
            }
            else {
                this._insertNode({ key: suffixes[n], items: [item] });
            }
        }
    }
    addMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.add(items[n]);
        }
    }
    remove(item) {
        let suffixes = this._symbolSuffixes(item);
        let node;
        let i;
        for (let n = 0; n < suffixes.length; ++n) {
            node = this._nodeFind(suffixes[n]);
            if (!node) {
                continue;
            }
            i = node.items.indexOf(item);
            if (i !== -1) {
                node.items.splice(i, 1);
                if (!node.items.length) {
                    this._deleteNode(node);
                }
            }
        }
    }
    removeMany(items) {
        for (let n = 0; n < items.length; ++n) {
            this.remove(items[n]);
        }
    }
    match(text) {
        let nodes = this._nodeMatch(text);
        let matches = [];
        for (let n = 0; n < nodes.length; ++n) {
            Array.prototype.push.apply(matches, nodes[n].items);
        }
        return Array.from(new Set(matches));
    }
    _nodeMatch(text) {
        let collator = this._collator;
        let lcText = text.toLowerCase();
        let compareLowerFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        let compareUpperFn = (n) => {
            return n.key.slice(0, lcText.length) === lcText ? -1 : 1;
        };
        return this._binarySearch.range(compareLowerFn, compareUpperFn);
    }
    _nodeFind(text) {
        let lcText = text.toLowerCase();
        let collator = this._collator;
        let compareFn = (n) => {
            return collator.compare(n.key, lcText);
        };
        return this._binarySearch.find(compareFn);
    }
    _insertNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        this._nodeArray.splice(rank, 0, node);
    }
    _deleteNode(node) {
        let collator = this._collator;
        let rank = this._binarySearch.rank((n) => {
            return collator.compare(n.key, node.key);
        });
        if (this._nodeArray[rank] === node) {
            this._nodeArray.splice(rank, 1);
        }
    }
    _symbolSuffixes(s) {
        let suffixes = PhpSymbol.suffixArray(s);
        let acronym = PhpSymbol.acronym(s);
        if (acronym.length > 1) {
            suffixes.push(acronym);
        }
        return suffixes;
    }
}
exports.SymbolIndex = SymbolIndex;
function resolveNamePhraseFqn(p, nameResolver, parsedDocument, symbolKind) {
    switch (p.phraseType) {
        case 142 /* RelativeQualifiedName */:
            return nameResolver.resolveRelative(parsedDocument.namespaceNameToString(p.name));
        case 139 /* QualifiedName */:
            return nameResolver.resolveNotFullyQualified(parsedDocument.namespaceNameToString(p.name), symbolKind);
        case 83 /* FullyQualifiedName */:
            return parsedDocument.namespaceNameToString(p.name);
        default:
            return '';
    }
}
class ExpressionResolver {
    constructor(nameResolver, symbolStore, parsedDocument, lookupVariableTypeDelegate) {
        this.nameResolver = nameResolver;
        this.symbolStore = symbolStore;
        this.parsedDocument = parsedDocument;
        this.lookupVariableTypeDelegate = lookupVariableTypeDelegate;
    }
    resolveExpression(node) {
        if (!node) {
            return new TypeString('');
        }
        switch (node.phraseType) {
            case 154 /* SimpleVariable */:
                return this.simpleVariable(node);
            case 158 /* SubscriptExpression */:
                return this.subscriptExpression(node);
            case 148 /* ScopedCallExpression */:
            case 150 /* ScopedPropertyAccessExpression */:
            case 134 /* PropertyAccessExpression */:
                return this.propertyAccessExpression(node);
            case 84 /* FunctionCallExpression */:
                return this.functionCallExpression(node);
            case 40 /* TernaryExpression */:
            case 110 /* MethodCallExpression */:
                return this.methodCallExpression(node);
            case 153 /* SimpleAssignmentExpression */:
            case 16 /* ByRefAssignmentExpression */:
            case 126 /* ObjectCreationExpression */:
            case 34 /* ClassTypeDesignator */:
            case 99 /* InstanceofTypeDesignator */:
            default:
                return null;
        }
    }
    classTypeDesignator(node) {
        if (!node.type) {
            return null;
        }
    }
    objectCreationExpression(node) {
        if (!node.type) {
            return null;
        }
        if (node.type.phraseType === 2 /* AnonymousClassDeclaration */) {
            return this.parsedDocument.createAnonymousName(node);
        }
        else if (node.type.phraseType === 34 /* ClassTypeDesignator */) {
            return this.classTypeDesignator(node.type);
        }
        else {
            return null;
        }
    }
    anonymousClassDeclaration(node) {
    }
    simpleVariable(node) {
        if (!node.name || node.name.tokenType !== 84 /* VariableName */) {
            return null;
        }
        return this.lookupVariableTypeDelegate(this.parsedDocument.tokenText(node.name));
    }
    subscriptExpression(node) {
        let type = this.resolveExpression(node.dereferencable);
        return type ? type.arrayDereference() : null;
    }
    functionCallExpression(node) {
        let qName = node.callableExpr;
        if (parsedDocument_1.ParsedDocument.isPhrase(qName, [83 /* FullyQualifiedName */, 139 /* QualifiedName */, 142 /* RelativeQualifiedName */])) {
            return null;
        }
        let functionName = resolveNamePhraseFqn(qName, this.nameResolver, this.parsedDocument, 64 /* Function */);
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === 64 /* Function */; });
        return symbol && symbol.type ? symbol.type : null;
    }
    methodCallExpression(node) {
        if (!node.memberName || node.variable) {
            return null;
        }
        let methodName = parsedDocument_1.ParsedDocument.isToken(node.memberName) ?
            this.parsedDocument.tokenText(node.memberName) :
            this.memberName(node.memberName);
        let type = this.resolveExpression(node.variable);
        if (!methodName || !type) {
            return null;
        }
        return this.mergeTypes(this.lookupMemberSymbols(type.atomicClassArray(), methodName, 32 /* Method */));
    }
    memberName(node) {
        return this.parsedDocument.tokenText(node.name);
    }
    propertyAccessExpression(node) {
        if (!node.memberName || !node.variable) {
            return null;
        }
        let propName = parsedDocument_1.ParsedDocument.isToken(node.memberName) ?
            this.parsedDocument.tokenText(node.memberName) :
            this.memberName(node.memberName);
        let type = this.resolveExpression(node.variable);
        if (!propName || !type) {
            return null;
        }
        let propSymbols = this.lookupMemberSymbols(type.atomicClassArray(), propName, 16 /* Property */);
        return this.mergeTypes(propSymbols);
    }
    lookupMemberSymbols(typeNames, memberName, kind) {
        let member;
        let members = [];
        let memberPredicate = (x) => {
            return kind === x.kind && memberName === x.name;
        };
        for (let n = 0, l = typeNames.length; n < l; ++n) {
            member = this.symbolStore.lookupTypeMember(typeNames[n], memberPredicate);
            if (member) {
                members.push(member);
            }
        }
        return members;
    }
    mergeTypes(symbols) {
        let type = new TypeString('');
        let symbol;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            symbol = symbols[n];
            if (symbol.type) {
                type = type.merge(symbol.type);
            }
        }
        return type;
    }
}
exports.ExpressionResolver = ExpressionResolver;
