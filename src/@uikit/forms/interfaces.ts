import {type Schema, type ValidationErrors} from "jopi-toolkit/jk_schema";
import React from "react";

//region Core

export type SubmitFunction = (params: { data: any, form: JFormController, hasFiles: boolean })
                              => Promise<JMessage|undefined|void> | JMessage | undefined | void;

export interface JFormComponentProps {
    schema: Schema;
    action?: string;
    submit?: SubmitFunction
}

export interface JFieldController {
    form: JFormController;
    variantName: string;

    name: string;
    type: string;

    error: boolean;
    errorMessage?: string;

    title?: string;
    description?: string;
    placeholder?: string;

    value: any;
    oldValue: any;
    onChange: (value: any) => void;
    valueConverter: (value: any, isTyping: boolean) => any;

    //region Type String

    minLength?: number;
    errorMessage_minLength?: string;

    maxLength?: number;
    errorMessage_maxLength?: string;

    //endregion

    //region Type Number

    minValue?: number;
    errorMessage_minValue?: string;

    maxValue?: number;
    errorMessage_maxValue?: string;

    allowDecimal?: boolean;
    roundMethod?: "round" | "floor" | "ceil";
    errorMessage_dontAllowDecimal?: string;

    incrStep?: number;

    //endregion

    //region Type File

    maxFileCount?: number;
    errorMessage_maxFileCount?: string;

    acceptFileType?: string;
    errorMessage_invalidFileType?: string;

    maxFileSize?: number;
    errorMessage_maxFileSize?: string;

    //endregion

    //region Type Boolean

    requireTrue?: boolean;
    errorMessage_requireTrue?: string;

    requireFalse?: boolean;
    errorMessage_requireFalse?: string;

    //endregion
}

export interface JFormController {
    error: boolean;
    submitting: boolean;
    submitted: boolean;
    formMessage?: JMessage;

    getData<T = any>(): T;
    getFormData(): FormData;
    getSubmitUrl(): string;

    sendFormData(url?: string): Promise<JMessage>;
    sendJsonData(url?: string): Promise<JMessage>;
}

export interface JMessage {
    isOk: boolean;
    isSubmitted: boolean;

    message?: string;
    code?: string;

    fieldErrors?: ValidationErrors;
}

//endregion

//region By type

export interface JFieldProps {
    name: string;
    title?: React.ReactNode;
    description?: React.ReactNode;
    placeholder?: string;

    variants?: JFormVariants;
    renderer?: React.FC<any>;

    id?: string;
}

export interface JFormMessageProps {
    id?: string;
    className?: string;

    variants?: JFormVariants;
    renderer?: React.FC<any>;

    isBefore?: boolean;
    message?: JMessage;

    errorMessage?: React.ReactNode;
    dataErrorMessage?: React.ReactNode|false;
    submittedMessage?: React.ReactNode|false;

    hideIfFieldErrors?: boolean;
}

export interface JFieldLabelProps {
    children: React.ReactNode;
    variants?: JFormVariants;
    renderer?: React.FC<any>;
    labelFor?: string;
    className?: string;

    field: JFieldController;
}

export interface JTextFormFieldProps extends JFieldProps {
}

export interface JNumberFormFieldProps extends JFieldProps {
}

export interface JCheckboxFormFieldProps extends JFieldProps {
    defaultChecked?: boolean;
}

export interface JFileSelectFieldProps extends JFieldProps {
}

export interface JNumberFormFieldProps extends JFieldProps {
    minValue?: number;
    maxValue?: number;
    incrStep?: number;
}

export interface JAutoFormFieldProps extends
    JTextFormFieldProps,
    JNumberFormFieldProps,
    JFileSelectFieldProps,
    JCheckboxFormFieldProps {
}

//endregion

export interface PassThrough_FormMessage {
    root: string;
    text: string;
}

export interface PassThrough_FieldLabel {
    label: string;
}

export interface PassThrough_TextFormField {
    root: string;
    textContainer: string;
    description: string;
    errorMessage: string;
    title: string;

    input: string;
}

export type PassThrough_NumberFormField  = PassThrough_TextFormField;

export interface PassThrough_CheckboxFormField {
    root: string;
    textContainer: string;
    description: string;
    errorMessage: string;

    title: string;
    checkBox: string;
}

export interface PassThrough_FileSelectField {
    root: string;

    dropZone: string;
    dropZoneIfDragOver: string;
    dropZoneIfNotDragOver: string;

    dropZoneIcon: string;
    dropZoneIconSvg: string;
    dropZoneTitle: string;
    dropZoneSubTitle: string;

    errorMessage: string;

    filePreviewRoot: string;
    filePreviewIcon: string;
    filePreviewIconSvg: string;

    fileTitle: string;
    fileSize: string;
    fileRemove: string;
    fileRemoveSvg: string;
}

export interface JFormVariants {
    /**
     * The className used for error messages.
     */
    clz_ErrorMessage?: string;

    //region FormMessage

    textFormSubmitSuccess?: string;
    textFormSubmitError?: string;
    textFormDataError?: string;

    FormMessage(p: JFormMessageProps): React.ReactElement|null;
    ptConfirm_FormMessage?: Partial<PassThrough_FormMessage>;
    ptConfirmExtra_FormMessage?: Partial<PassThrough_FormMessage>;
    ptError_FormMessage?: Partial<PassThrough_FormMessage>;
    ptErrorExtra_FormMessage?: Partial<PassThrough_FormMessage>;

    //endregion

    //region FieldLabel

    FieldLabel(p: JFieldLabelProps): React.ReactElement;

    pt_FieldLabel?: Partial<PassThrough_FieldLabel>;
    ptExtra_FieldLabel?: Partial<PassThrough_FieldLabel>;
    ptError_FieldLabel?: Partial<PassThrough_FieldLabel>;

    //endregion

    //region TextFormField

    TextFormField(p: JTextFormFieldProps): React.ReactElement;
    pt_TextFormField?: Partial<PassThrough_TextFormField>;
    ptExtra_TextFormField?: Partial<PassThrough_TextFormField>;
    ptError_TextFormField?: Partial<PassThrough_TextFormField>;

    //endregion

    //region NumberFormField

    NumberFormField(p: JNumberFormFieldProps): React.ReactElement;
    pt_NumberFormField?: Partial<PassThrough_NumberFormField>;
    ptExtra_NumberFormField?: Partial<PassThrough_NumberFormField>;
    ptError_NumberFormField?: Partial<PassThrough_NumberFormField>;

    //endregion

    //region CheckboxFormField

    CheckboxFormField(p: JCheckboxFormFieldProps): React.ReactElement;
    pt_CheckboxFormField?: Partial<PassThrough_CheckboxFormField>;
    ptExtra_CheckboxFormField?: Partial<PassThrough_CheckboxFormField>;
    ptError_CheckboxFormField?: Partial<PassThrough_CheckboxFormField>;

    //endregion

    //region FileSelectField

    FileSelectField(p: JFileSelectFieldProps): React.ReactElement;

    pt_FileSelectField?: Partial<PassThrough_FileSelectField>;
    ptExtra_FileSelectField?: Partial<PassThrough_FileSelectField>;
    ptError_FileSelectField?: Partial<PassThrough_FileSelectField>;

    textFileSelectFieldTitle?: string;
    textFileSelectFieldSubTitle?: string;
    textFileSelectFieldDragging?: string;

    //endregion

}