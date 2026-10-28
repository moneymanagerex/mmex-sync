/// Definizione di un vincolo di unicità: può essere su singola colonna o su colonne multiple composite
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UniqueConstraint {
    Single(&'static str),
    Composite(&'static [&'static str]),
}

/// Definizione dei metadati di una tabella MMEX per la sincronizzazione
#[derive(Debug, Clone)]
pub struct TableConfig {
    pub pk: &'static str,
    pub fields: &'static [&'static str],
    pub unique: &'static [UniqueConstraint],
}

/// Ordine topologico di sincronizzazione (rispetta le dipendenze da Foreign Key)
pub const SYNC_ORDER: &[&str] = &[
    // Livello 1: Tabelle indipendenti (nessuna dipendenza esterna)
    "INFOTABLE_V1",
    "CURRENCYFORMATS_V1",
    "TAG_V1",
    "BUDGETYEAR_V1",
    "CUSTOMFIELD_V1",

    // Livello 2: Anagrafiche primarie (dipendono dal Livello 1)
    "CATEGORY_V1",
    "PAYEE_V1",
    "ACCOUNTLIST_V1",

    // Livello 3: Entità principali e asset (dipendono dal Livello 2)
    "ASSETS_V1",
    "STOCK_V1",
    "CHECKINGACCOUNT_V1",
    "BILLSDEPOSITS_V1",
    "BUDGETTABLE_V1",

    // Livello 4: Dettagli transazioni e storico (dipendono dal Livello 3)
    "SPLITTRANSACTIONS_V1",
    "BUDGETSPLITTRANSACTIONS_V1",
    "CURRENCYHISTORY_V1",
    "STOCKHISTORY_V1",
    "ATTACHMENT_V1",
    "TAGLINK_V1",
    "TRANSLINK_V1",
    "SHAREINFO_V1",
    "CUSTOMFIELDDATA_V1",
];

/// Restituisce la configurazione della tabella indicata
pub fn get_table_config(table: &str) -> Option<TableConfig> {
    match table {
        "INFOTABLE_V1" => Some(TableConfig {
            pk: "INFOID",
            fields: &["INFONAME", "INFOVALUE"],
            unique: &[UniqueConstraint::Single("INFONAME")],
        }),
        "CURRENCYFORMATS_V1" => Some(TableConfig {
            pk: "CURRENCYID",
            fields: &[
                "CURRENCYNAME",
                "PFX_SYMBOL",
                "SFX_SYMBOL",
                "DECIMAL_POINT",
                "GROUP_SEPARATOR",
                "UNIT_NAME",
                "CENT_NAME",
                "SCALE",
                "BASECONVRATE",
                "CURRENCY_SYMBOL",
                "CURRENCY_TYPE",
            ],
            unique: &[
                UniqueConstraint::Single("CURRENCYNAME"),
                UniqueConstraint::Single("CURRENCY_SYMBOL"),
            ],
        }),
        "CATEGORY_V1" => Some(TableConfig {
            pk: "CATEGID",
            fields: &["CATEGNAME", "ACTIVE", "PARENTID"],
            unique: &[UniqueConstraint::Composite(&["CATEGNAME", "PARENTID"])],
        }),
        "TAG_V1" => Some(TableConfig {
            pk: "TAGID",
            fields: &["TAGNAME", "ACTIVE"],
            unique: &[],
        }),
        "PAYEE_V1" => Some(TableConfig {
            pk: "PAYEEID",
            fields: &[
                "PAYEENAME", "CATEGID", "NUMBER", "WEBSITE", "NOTES", "ACTIVE", "PATTERN",
            ],
            unique: &[UniqueConstraint::Single("PAYEENAME")],
        }),
        "ACCOUNTLIST_V1" => Some(TableConfig {
            pk: "ACCOUNTID",
            fields: &[
                "ACCOUNTNAME",
                "ACCOUNTTYPE",
                "ACCOUNTNUM",
                "STATUS",
                "NOTES",
                "HELDAT",
                "WEBSITE",
                "CONTACTINFO",
                "ACCESSINFO",
                "INITIALBAL",
                "INITIALDATE",
                "FAVORITEACCT",
                "CURRENCYID",
                "STATEMENTLOCKED",
                "STATEMENTDATE",
                "MINIMUMBALANCE",
                "CREDITLIMIT",
                "INTERESTRATE",
                "PAYMENTDUEDATE",
                "MINIMUMPAYMENT",
            ],
            unique: &[UniqueConstraint::Single("ACCOUNTNAME")],
        }),
        "ASSETS_V1" => Some(TableConfig {
            pk: "ASSETID",
            fields: &[
                "STARTDATE",
                "ASSETNAME",
                "ASSETSTATUS",
                "CURRENCYID",
                "VALUECHANGEMODE",
                "VALUE",
                "VALUECHANGE",
                "NOTES",
                "VALUECHANGERATE",
                "ASSETTYPE",
            ],
            unique: &[],
        }),
        "STOCK_V1" => Some(TableConfig {
            pk: "STOCKID",
            fields: &[
                "HELDAT",
                "PURCHASEDATE",
                "STOCKNAME",
                "SYMBOL",
                "NUMSHARES",
                "PURCHASEPRICE",
                "NOTES",
                "CURRENTPRICE",
                "VALUE",
                "COMMISSION",
            ],
            unique: &[],
        }),
        "CHECKINGACCOUNT_V1" => Some(TableConfig {
            pk: "TRANSID",
            fields: &[
                "ACCOUNTID",
                "TOACCOUNTID",
                "PAYEEID",
                "TRANSCODE",
                "TRANSAMOUNT",
                "STATUS",
                "TRANSACTIONNUMBER",
                "NOTES",
                "CATEGID",
                "TRANSDATE",
                "LASTUPDATEDTIME",
                "DELETEDTIME",
                "FOLLOWUPID",
                "TOTRANSAMOUNT",
                "COLOR",
            ],
            unique: &[],
        }),
        "BILLSDEPOSITS_V1" => Some(TableConfig {
            pk: "BDID",
            fields: &[
                "ACCOUNTID",
                "TOACCOUNTID",
                "PAYEEID",
                "TRANSCODE",
                "TRANSAMOUNT",
                "STATUS",
                "TRANSACTIONNUMBER",
                "NOTES",
                "CATEGID",
                "TRANSDATE",
                "FOLLOWUPID",
                "TOTRANSAMOUNT",
                "REPEATS",
                "NEXTOCCURRENCEDATE",
                "NUMOCCURRENCES",
                "COLOR",
            ],
            unique: &[],
        }),
        "SPLITTRANSACTIONS_V1" => Some(TableConfig {
            pk: "SPLITTRANSID",
            fields: &["TRANSID", "CATEGID", "SPLITTRANSAMOUNT", "NOTES"],
            unique: &[],
        }),
        "BUDGETYEAR_V1" => Some(TableConfig {
            pk: "BUDGETYEARID",
            fields: &["BUDGETYEARNAME"],
            unique: &[UniqueConstraint::Single("BUDGETYEARNAME")],
        }),
        "BUDGETTABLE_V1" => Some(TableConfig {
            pk: "BUDGETENTRYID",
            fields: &[
                "BUDGETYEARID",
                "CATEGID",
                "PERIOD",
                "AMOUNT",
                "NOTES",
                "ACTIVE",
            ],
            unique: &[],
        }),
        "BUDGETSPLITTRANSACTIONS_V1" => Some(TableConfig {
            pk: "SPLITTRANSID",
            fields: &["TRANSID", "CATEGID", "SPLITTRANSAMOUNT", "NOTES"],
            unique: &[],
        }),
        "CURRENCYHISTORY_V1" => Some(TableConfig {
            pk: "CURRHISTID",
            fields: &["CURRENCYID", "CURRDATE", "CURRVALUE", "CURRUPDTYPE"],
            unique: &[UniqueConstraint::Composite(&["CURRENCYID", "CURRDATE"])],
        }),
        "STOCKHISTORY_V1" => Some(TableConfig {
            pk: "HISTID",
            fields: &["SYMBOL", "DATE", "VALUE", "UPDTYPE"],
            unique: &[UniqueConstraint::Composite(&["SYMBOL", "DATE"])],
        }),
        "ATTACHMENT_V1" => Some(TableConfig {
            pk: "ATTACHMENTID",
            fields: &["REFTYPE", "REFID", "DESCRIPTION", "FILENAME"],
            unique: &[],
        }),
        "TAGLINK_V1" => Some(TableConfig {
            pk: "TAGLINKID",
            fields: &["REFTYPE", "REFID", "TAGID"],
            unique: &[UniqueConstraint::Composite(&["REFTYPE", "REFID", "TAGID"])],
        }),
        "TRANSLINK_V1" => Some(TableConfig {
            pk: "TRANSLINKID",
            fields: &["CHECKINGACCOUNTID", "LINKTYPE", "LINKRECORDID"],
            unique: &[],
        }),
        "SHAREINFO_V1" => Some(TableConfig {
            pk: "SHAREINFOID",
            fields: &[
                "CHECKINGACCOUNTID",
                "SHARENUMBER",
                "SHAREPRICE",
                "SHARECOMMISSION",
                "SHARELOT",
            ],
            unique: &[],
        }),
        "CUSTOMFIELD_V1" => Some(TableConfig {
            pk: "FIELDID",
            fields: &["REFTYPE", "DESCRIPTION", "TYPE", "PROPERTIES"],
            unique: &[],
        }),
        "CUSTOMFIELDDATA_V1" => Some(TableConfig {
            pk: "FIELDATADID",
            fields: &["FIELDID", "REFID", "CONTENT"],
            unique: &[UniqueConstraint::Composite(&["FIELDID", "REFID"])],
        }),
        _ => None,
    }
}

/// Mappa di propagazione Foreign Key: dato il nome della colonna Primary Key,
/// restituisce l'elenco delle colonne che possono referenziarla come chiave esterna.
pub fn get_referencing_fk_columns(pk_column: &str) -> &'static [&'static str] {
    match pk_column {
        "ACCOUNTID" => &["ACCOUNTID", "TOACCOUNTID"],
        "CATEGID" => &["CATEGID", "PARENTID"],
        "PAYEEID" => &["PAYEEID"],
        "CURRENCYID" => &["CURRENCYID"],
        "TAGID" => &["TAGID"],
        "BUDGETYEARID" => &["BUDGETYEARID"],
        "FIELDID" => &["FIELDID"],
        "TRANSID" => &["TRANSID", "CHECKINGACCOUNTID"],
        "ASSETID" => &["ASSETID"],
        "STOCKID" => &["STOCKID"],
        _ => &[],
    }
}
