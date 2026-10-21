# Reviewing a document and posting it into stock

For everyone who receives deliveries; what each role may do is said at each step. The words on screen are given in Spanish, with English in brackets. Sending a document and watching it being read is in [Receiving a document](receiving-documents.md).

**To try it on staging:** **Documentos** (Documents) has three made-up delivery notes waiting for review, and an invoice. One photo has prices and a supplier we know; another has no prices and a supplier to create; the PDF is long, with one line where nothing was delivered. The invoice, from Carnes Ficticias, bills the first photo's delivery note: post that delivery note first, and the invoice then suggests each line's delivery note, two of them at new prices (see "Posting an invoice").

## Reviewing what was read

Once a document is **Listo para revisar** (Ready for review), its page opens on **Revisar lo leído** (Review what was read): the original on one side (above it on a phone), and what was read on the other.

- **Tap a photo to enlarge it.** Zoom in and out with the buttons, or with the + and − keys.
- **Antes de registrarlo** (Before posting it) lists what's left before the document can be posted: a missing supplier, a failed check, a line without its product, an invoice's line without its delivery note, or a new supplier. If it can't be loaded, it says so: tap **Reintentar** (Try again). Until it loads, the document can be corrected but not posted.
- **Comprobaciones** (Checks) lists each failed check. Tap one to go to its field.
- **Correct any field,** or add and remove lines. The checks run again a moment after each change.
- **Tap Guardar correcciones** (Save corrections). What the model read is kept apart from your corrections, and shows under **Lo que leyó el modelo** (What the model read).

**Counter users** correct only a delivery note's quantities: check them against what arrived.

## The supplier and each line's product (office and owner)

- **The supplier** is found by the tax ID read. If none is found, choose one with **Elegir un proveedor** (Choose a supplier) by typing part of its name, or create it with **Crear proveedor** (Create a supplier): its name and tax ID come filled in from what was read.
- **Each line's product:** a line the supplier sent before shows its product. For a new one, **Confirmar el producto** (Confirm the product) takes the one suggested, and **Elegir producto** (Choose a product) picks another. Give the pack: what one of the line's units holds, such as "1 caja = 6 kg". It's remembered, so the supplier's next documents match it by themselves.
- **Products are chosen once the supplier is,** and once corrections are saved.

## Posting a delivery note

1. **Check each line's storeroom.** Under its product, **Almacén** (Storeroom) starts on the product's own one, marked **(el suyo)** (its own). Choose another if the goods went elsewhere.
2. **Tap Registrar el albarán** (Post the delivery note), then **Registrar** (Post). It goes into stock, and can't be changed after.

The page then shows **En stock** (In stock): each line as printed, and what it put in stock, where, and at what cost. For example, "Entrada: 5 kg · Cámara frigorífica · 1,80 €/kg".

**Who may post:**
- **office and owner,** once nothing is left but a new supplier: they are the review a new supplier's first documents go to;
- **counter users,** only once nothing at all is left: a known supplier, every line's product known, every check passed.

When the button can't be used, the reason is next to it.

**A line without a price** goes in at 0 € until the invoice corrects it.

## Posting an invoice (office and owner)

An invoice corrects the prices of the delivery notes it bills. Its review screen is the same, with one more thing on each line: the delivery-note line it bills.

1. **Check each line's delivery note.** A line shows the one suggested, such as "Sugerido: albarán ALB-0001 del 21/10/2026, línea 2 · 2 garrafa" (Suggested: delivery note ALB-0001 of 21/10/2026, line 2). It's suggested from the delivery notes the invoice lists, or else the supplier's of the two months before it, when only one line could be it.
   - **Confirmar el albarán** (Confirm the delivery note) takes it.
   - **Elegir otro albarán** (Choose another delivery note) lists every posted delivery-note line of the supplier not billed yet, older ones included. Choosing one already chosen for another line moves it.
   - **Sin albarán: entra en stock con la factura** (No delivery note: it goes into stock with the invoice) is for goods that came with the invoice. The line then needs its product and storeroom, like a delivery note's. A supplier that sends only invoices starts with every line like this.
2. **Look at the prices.** Each line says the delivery note's price, the invoice's, and the difference in euros. **Diferencias de precio** (Price differences) has them all, and the total. A line whose quantity isn't what the delivery note received says so: correct it, or choose another delivery note.
3. **Tap Registrar la factura** (Post the invoice), then **Registrar** (Post). Stock doesn't change: what the delivery notes brought in is now at the invoice's price, and each product's average cost follows.

The page then shows each line's delivery note, with a link to it, and what it corrected. For example, "Corrección de precio: 10 l · Almacén seco · 5,20 €/l" (Price correction) and the "Anulación" (Reversal) of the old price. A line at the same price corrects nothing. The delivery note's page says which invoice bills each line.

**A product's page** shows its stock and average cost in each storeroom, to office and the owner, under **Stock**.

**A credit note** (factura rectificativa) is an invoice with a negative total. A negative price on a line that bills a delivery note lowers that line's price; a negative quantity received with it is a return.

Counter users see an invoice in review as read, without changing or posting it.

## Reversing a posted document (owner)

1. **Tap Anular** (Reverse), then **Anular** again. What it brought in leaves stock, and this can't be undone. The page then says **Anulado** (Reversed), when and by whom, and shows the movements that undid it.
2. **Tap Corregir y volver a registrar** (Correct and post again) to review a corrected copy. It opens in review with what was posted, and the original's photos. Post it as above. The copy and the reversed document link to each other.

A delivery note an invoice still bills can't be reversed until that invoice is. An invoice can't be reversed while a later one, a credit note say, bills the same lines: reverse the later one first.
