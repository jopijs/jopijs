import {
    type ColumnFiltersState, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
    type SortingState, useReactTable, type VisibilityState, type ColumnDef, type PaginationState
} from "@tanstack/react-table";

import * as React from "react";
import * as jk_schema from "jopi-toolkit/jk_schema";
import type {
    JCellRenderer, JCellRendererParams, JCellRendererProvider, JColumnHeaderRendererParams,
    JCreateColumnsParams, JDataProvider,
    JFieldRenderingRules,
    JFieldWithRenderer,
    JTableParams
} from "./interfaces.ts";
import {useEffect, useState} from "react";

function getNormalizedScheme(params: JCreateColumnsParams): Record<string, JFieldWithRenderer> {
    function merge(baseRules: jk_schema.ScOnTableRenderingInfo|undefined, newRules: JFieldRenderingRules) {
        if (!baseRules) return newRules;
        if (newRules.mergeMode === "replace") return newRules;
        return {...baseRules, ...newRules};
    }

    if (!params.columnsOverride) {
        return params.schema.desc;
    }

    let fields = params.schema.desc;
    let res: Record<string, JFieldWithRenderer> = {};

    for (const [fieldId, field] of Object.entries(fields)) {
        let override = params.columnsOverride[fieldId];

        if (override) {
            let field2: JFieldWithRenderer = {...field};
            field2.onTableRendering = merge(field.onTableRendering, override);
            res[fieldId] = field2;
        } else {
            res[fieldId] = field;
        }
    }

    return res;
}

function calcColumnsVisibility(params: JCreateColumnsParams): VisibilityState {
    let result: VisibilityState = {};
    let fields = getNormalizedScheme(params);

    for (const [fieldId, field] of Object.entries(fields)) {
        if (field.onTableRendering?.defaultHidden) {
            result[fieldId] = false;
        }
    }

    return result;
}

function createColumns<T>(params: JCreateColumnsParams): ColumnDef<T>[] {
    function getCellCoreRenderer(p: JCellRendererParams): JCellRenderer {
        if (p.field.onTableRendering?.rendererForCell) {
            let rendererValue = p.field.onTableRendering!.rendererForCell;

            if (typeof rendererValue === "string") {
                if (p.canEdit) rendererValue += "__edit";
                let renderer = params.variants[rendererValue];
                if (renderer) return (renderer as JCellRendererProvider)(p);

                if (p.canEdit) {
                    renderer = params.variants[rendererValue];
                    if (renderer) return (renderer as JCellRendererProvider)(p);
                }
            } else {
                return rendererValue(p);
            }
        }

        // number car be displayed as decimal /percent / currency or simple number.
        //
        if (p.field.type==="number") {
            let fieldNumber = p.field as jk_schema.ScNumber;
            let displayType = fieldNumber.displayType;

            let renderer: undefined | ((params: JCellRendererParams) => JCellRenderer);

            if (displayType==="currency") {
                renderer = params.variants.cellRenderer_currency;
            } else if (displayType==="percent") {
                renderer = params.variants.cellRenderer_percent;
            } else if (displayType==="decimal") {
                renderer = params.variants.cellRenderer_decimal;
            }

            if (!renderer) {
                renderer = params.variants.cellRenderer_number;
            }

            if (renderer) {
                return renderer(p);
            }
        }

        return params.variants.cellRenderer(p);
    }

    let fields = getNormalizedScheme(params);
    let result: ColumnDef<T>[] = [];

    if (params.canSelectColumns) {
        result.push({
            id: "!select",

            header: params.variants.selectRowsHeaderRenderer(),
            cell:params.variants.selectRowsCellRenderer(),

            enableSorting: false,
            enableHiding: false,

            size: params.variants.selectRowWidth ? params.variants.selectRowWidth : 40
        })
    }

    for (const [fieldId, field] of Object.entries(fields)) {
        if (field.onTableRendering?.alwaysHidden) continue;

        let canHide = field.onTableRendering?.enableHiding;
        if (canHide===undefined) canHide = true;

        let canSort = field.onTableRendering?.enableSorting !== false;
        let canEdit = params.enableEditing === true;

        let title = field.title;
        if (field.onTableRendering?.title) title = field.onTableRendering!.title;

        const p: JColumnHeaderRendererParams = {
            builderParams: params, variants: params.variants,
            fieldId, field, canSort, canEdit, title
        };

        const cellRenderer = getCellCoreRenderer(p);
        const headerRenderer = params.variants.columnHeaderRenderer(p);

        let growStrategy = field.onTableRendering?.columnGrow;

        result.push({
            accessorKey: fieldId,
            enableSorting: p.canSort,
            enableHiding: canHide,

            cell: cellRenderer,
            header: headerRenderer,

            enableResizing: growStrategy !== "takeAllPlace"
        });
    }

    if (params.actions) {
        result.push({
            id: "!actions",

            cell: params.variants.createActionCell(params.actions),

            enableSorting: false,
            enableHiding: false,

            size: params.variants.actionRowWidth ? params.variants.actionRowWidth : 40
        })
    }

    return result;
}

export function JTable(p: JTableParams) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [rowSelection, setRowSelection] = React.useState({});

    const [visibleRows, setVisibleRows] = useState<any[]>([]);
    const [allRows, setAllRows] = useState<any[]>([]);
    const [myRowCount, setMyRowCount] = useState(0);

    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => calcColumnsVisibility(p));
    const [columns] = React.useState(() => createColumns(p));
    const [isLoadingData, setIsLoadingData] = useState(false);
    const [pagination, setPagination] = useState<PaginationState>({pageIndex: 0, pageSize: p.pageSize || 20});

    const manualPagination = !(p.data instanceof Array);

    const tTable = useReactTable({
        //debugTable: true,

        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
            pagination
        },

        data: manualPagination ? visibleRows : (p.data as any[]),
        rowCount: manualPagination ? myRowCount : undefined,
        manualPagination: manualPagination ? true : undefined,

        columns: columns,
        onPaginationChange: setPagination,

        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection
    });

    useEffect(() => {
        if (manualPagination) {
            async function loadData(provider: JDataProvider) {
                const pageSize = pagination.pageSize;
                const pageIndex = pagination.pageIndex;

                // What we want to load.
                let maxOffset = ((pageIndex * pageSize) + pageSize);
                let newAllRows = allRows;

                // Need loading some data?
                //
                if (allRows.length < maxOffset) {
                    // Force showing the loading screen.
                    //setVisibleRows([]);

                    // Load what we need, without gaps.
                    //
                    let offset = allRows.length;
                    let res = await provider({offset, count: maxOffset - offset});

                    // allRows contains all the rows.
                    newAllRows = allRows.concat(res.rows);
                    setAllRows(newAllRows);

                    // Update the total rows count if the returned information is not the same.
                    if ((res.total!==undefined) && (res.total!==myRowCount)) setMyRowCount(res.total);
                }

                // Update the visible rows.
                //
                let offset = pageIndex * pageSize;
                let newVisibleRows = newAllRows.slice(pageIndex * pageSize, offset+pageSize);
                setVisibleRows(newVisibleRows);
            }

            (async () => {
                try {
                    setIsLoadingData(true);
                    await loadData(p.data as JDataProvider);
                } finally {
                    setIsLoadingData(false);
                }
            })();
        }
    }, [p.data, pagination]);

    return p.variants.layoutRenderer({
        isLoadingData,
        variants: p.variants,

        table: p.variants.tableRenderer({table: tTable, ifNoContent: p.children}),

        filter: (p.showFilter!==false) && p.variants.filterRenderer({
            table: tTable,
            isLoadingData,
            filterField: p.filterField,
            placeholder: p.filterPlaceholder
        }),

        columnsSelector: (p.showColumnsSelector!==false) && p.variants.columnsSelectorRenderer({table: tTable, isLoadingData}),
        statistics: p.variants.statisticsRenderer({table: tTable, isLoadingData}),
        pageSelector: p.variants.pageSelectorRenderer({table: tTable, isLoadingData})
    });
}