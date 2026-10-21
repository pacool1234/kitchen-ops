# Checking the stock, recording waste and moving stock

For every role. Counter staff see how much there is; office and the owner also see what it cost and what it's worth. Everyone records waste and moves stock between storerooms, on a phone or a computer. The words on screen are given in Spanish, with English in brackets.

**To try it on staging:** post one of the demo delivery notes first (see [Reviewing a document and posting it into stock](reviewing-and-posting.md)), so there's stock to see. Then, in **Stock**, record some of it as waste, move some to another storeroom, and follow each from the product's movements to its page.

## The stock list

Open **Stock** in the menu. Each row is one product in one storeroom it has ever been in, in alphabetical order:

- **En stock** (In stock): how much is there now, in kilos, litres or units. A product whose stock has all gone shows 0 until more comes in.
- **Coste medio** (Average cost), for office and the owner: what it cost per kilo, litre or unit, averaged over what came in. An invoice that corrects a delivery note's price changes it.
- **Valor** (Value), for office and the owner: how much is there times its average cost, in euros.

Above the list, office and the owner see **Valor del stock** (Stock value): what each storeroom holds, in euros, and the **Total**. These are always the whole stock's, whatever is searched.

To find something, type part of its name in **Buscar** (Search): case and accents don't matter, so "limon" finds "Limón". Choose a **Almacén** (Storeroom) or a **Categoría** (Category) to see only those. Long lists come 50 rows a page; the buttons below the list move between pages.

On a phone, each row is a card: the product and its storeroom, with how much there is on the right.

## A product's stock

Tap a product's name. Its page shows:

- **En cada almacén** (In each storeroom): how much it has in each, and, for office and the owner, its average cost and value there.
- **Movimientos** (Movements): everything that moved its stock, newest first, 20 a page. Each says its date, what happened, the storeroom, and how much went in (**+5 kg**) or out (**-4 kg**). Office and the owner also see what it cost per kilo, litre or unit.

What happened:

- **Entrada** (Receipt): it came in with a delivery note or an invoice.
- **Merma** (Waste): it was thrown away.
- **Recuento** (Count): a count put the stock right. 0 means the count matched.
- **Traspaso (salida)** and **Traspaso (entrada)** (Transfer out and in): it moved from one storeroom to another; a transfer shows both.
- **Anulación** (Reversal): the owner reversed the document that moved it.

A movement marked **Ajuste** (Adjustment) was allowed to take the stock below zero: a count made before something was used, but sent after.

The last column names the document. A delivery note or an invoice links to its page, where its lines and movements are. Waste and transfers link to theirs (below). A reversal links to the document it reversed, which shows both. Counts don't have pages yet.

## Recording waste

When something is thrown away, tap **Registrar merma** (Record waste) at the top of **Stock**:

1. Choose the **Almacén** (Storeroom) it was in, and the **Motivo** (Reason): **Caducado** (Expired), **Estropeado** (Spoiled), **Roto** (Broken), **Error de preparación** (Prep error) or **Otro** (Other). A **Nota** (Note) is optional, for when the reason needs explaining.
2. For each product, type part of its name in **Producto** and choose it. Type the **Cantidad** (Quantity), with a comma or a point: "1,5". The **Unidad** (Unit) starts in kilos, litres or units, whichever the product is counted in; it can also be one of the product's purchase units, such as a "caja". **Añadir otro producto** (Add another product) adds a line.
3. Tap **Registrar** (Record). A box lists what will be taken out, and from where; tap **Registrar** again to confirm.

If there isn't that much in stock, the line says **No hay tanto en stock** (There isn't that much in stock), and nothing is recorded. Correct it and record again.

Once recorded, its page opens: what was taken out of where, why and by whom.

## Moving stock between storerooms

Tap **Registrar traspaso** (Record a transfer) at the top of **Stock**. Choose where it comes from (**Origen**, From) and where it goes (**Destino**, To), then the products and quantities, as for waste. Confirm, and its page shows what left one storeroom and arrived in the other. A transfer moves stock at what it cost: what the stock is worth stays the same.

## A waste or transfer's page

It shows where, why and by whom, and each product's movements, with what they cost for office and the owner. It can't be changed. If it's wrong, the owner taps **Anular** (Reverse): the stock goes back where it was, and the page then shows the reversal, when and by whom. Record it again correctly.

If the connection drops while recording and you tap **Registrar** again, it's recorded only once. If you changed something in between, the page says it was already recorded as first sent, with a link to it.
