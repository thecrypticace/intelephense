import { PhpSymbol, SymbolKind } from './symbol';
export declare class NameResolver {
    private _classStack;
    rules: PhpSymbol[];
    namespace: string;
    constructor();
    readonly className: string;
    readonly classBaseName: string;
    /**
     *
     * @param classNameTuple className, classBaseName
     */
    pushClassName(classNameTuple: [string, string]): void;
    popClassName(): void;
    resolveRelative(relativeName: string): string;
    resolveNotFullyQualified(notFqn: string, kind?: SymbolKind): string;
    concatNamespaceName(prefix: string, suffix: string): string;
    /**
     *
     * @param text unqualified name
     * @param kind
     */
    matchImportedSymbol(text: string, kind: SymbolKind): PhpSymbol;
    private _resolveQualified(name, pos);
    private _resolveUnqualified(name, kind);
}
