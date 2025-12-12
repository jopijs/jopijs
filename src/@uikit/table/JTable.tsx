// noinspection DuplicatedCode

import {
    type ColumnFiltersState, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
    type SortingState, useReactTable, type VisibilityState, type ColumnDef, type PaginationState
} from "@tanstack/react-table";

import * as React from "react";
import * as jk_schema from "jopi-toolkit/jk_schema";
import * as jk_timer from "jopi-toolkit/jk_timer";
import type {
    JCellRenderer, JCellRendererParams, JCellRendererProvider, JColumnHeaderRendererParams,
    JCreateColumnsParams,
    JFieldRenderingRules,
    JFieldWithRenderer,
    JTableParams
} from "./interfaces.ts";
import {useState} from "react";

import {type JFieldSorting, type JTableDs_ReadParams} from "jopi-toolkit/jk_data";
import {useQuery} from '@tanstack/react-query'

function getNormalizedScheme(params: JCreateColumnsParams): Record<string, JFieldWithRenderer> {
    function merge(baseRules: jk_schema.ScOnTableRenderingInfo|undefined, newRules: JFieldRenderingRules) {
        if (!baseRules) return newRules;
        if (newRules.mergeMode === "replace") return newRules;
        return {...baseRules, ...newRules};
    }

    if (!params.columnsOverride) {
        return params.schema!.desc;
    }

    let fields = params.schema!.desc;
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

function convertSortingState(sorting: SortingState): JFieldSorting[]|undefined {
    if (!sorting.length) return undefined;

    return sorting.map(s => {
        return {
            field: s.id,
            direction: s.desc ? "desc" : "asc"
        }
    });
}

export function JTable(p: JTableParams) {
    p = {...p};
    if (p.dataSource) p.schema = p.dataSource.schema;
    if (!p.schema) throw new Error("A schema must be provided.");

    const [sorting, setSorting] = React.useState<SortingState>([]);

    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [rowSelection, setRowSelection] = React.useState({});

    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => calcColumnsVisibility(p));
    const [columns] = React.useState(() => createColumns(p));

    const [pagination, setPagination] = useState<PaginationState>({pageIndex: 0, pageSize: p.pageSize || 20});
    const [filter, setFilter] = React.useState("");

    const [previousQueryData, setPreviousQueryData] = useState<any>(undefined);

    function doSetFilter(newValue: string) {
        setFilter(newValue);
        setPagination({pageIndex: 0, pageSize: pagination.pageSize});

        if (p.filterField) {
            return tTable.getColumn(p.filterField)?.setFilterValue(newValue)
        } else {
            return tTable.setGlobalFilter(newValue);
        }
    }
    
    function doSetSorting(sorting: SortingState) {
        setSorting(sorting);
        setPagination({pageIndex: 0, pageSize: pagination.pageSize});
    }

    let queryData: any = undefined;

    // Data are loading / fetching state
    //
    // -- Workflow--
    // 1- isLoadingData is true
    // 2- TanStack takes data from the local cache
    //    --> isLoadingData = false
    //    + we show the cached data
    // 3- In the background, TanStack loads data from the server
    //    --> isRefreshingData = true
    // 4- Data are loaded from the server
    //    --> isRefreshingData = true
    //    + we show the refreshed data
    //
    let isLoadingData = false;
    let isRefreshingData = false;

    if (p.dataSource) {
        const query = useQuery({
            queryKey: ["dsTable", p.dataSource!.name, {
                page: {pageOffset: pagination.pageIndex, pageSize: pagination.pageSize},
                filter: filter ? {field: p.filterField, value: filter} : undefined,
                sorting: convertSortingState(sorting)
            }],

            queryFn: async (ctx) => {
                let res = await p.dataSource?.read(ctx.queryKey[2] as JTableDs_ReadParams);
                await jk_timer.sleep(2000)
                return res;
            },

            // The placeholder data are date returned while
            // loading the initial data set. Here where use the previous data set.
            // Doing that avoid screen flickering.
            //
            placeholderData: previousQueryData
        });

        // dataUpdatedAt allows knowing we are not
        // using the local cache nor the data placeholder.
        //
        isLoadingData = (query.isLoading === true) || (!query.dataUpdatedAt);

        isRefreshingData = query.isFetching === true;

        queryData = query.data;

        // It allows avoiding emptying when no cached data are available.
        if (previousQueryData != queryData) setPreviousQueryData(queryData);
    }

    const tTable = useReactTable({
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
            pagination
        },

        data: p.dataSource ? queryData?.rows || [] : p.data!,
        rowCount: p.dataSource ? queryData?.total : undefined,
        manualPagination: p.dataSource ? true : undefined,
        manualSorting: p.dataSource ? true : undefined,

        columns: columns,
        onPaginationChange: setPagination,

        onSortingChange: (updater) => {
            const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
            doSetSorting(newSorting);
        },

        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection
    });

    return p.variants.layoutRenderer({
        isLoadingData: isLoadingData,
        isRefreshingData: !isLoadingData && isRefreshingData,

        variants: p.variants,

        table: p.variants.tableRenderer({table: tTable, ifNoContent: p.children}),

        filter: (p.showFilter!==false) && p.variants.filterRenderer({
            table: tTable,
            isLoadingData: isRefreshingData,
            filterField: p.filterField,
            placeholder: p.filterPlaceholder,
            filter, setFilter: doSetFilter
        }),

        columnsSelector: (p.showColumnsSelector!==false) && p.variants.columnsSelectorRenderer({table: tTable, isLoadingData: isRefreshingData}),
        statistics: p.variants.statisticsRenderer({table: tTable, isLoadingData: isRefreshingData}),
        pageSelector: p.variants.pageSelectorRenderer({table: tTable, isLoadingData: isRefreshingData})
    });
}