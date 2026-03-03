
function deleteOrder(d) {
  try {
    const s = mustSheet_("Orders");
    const id = String(d.id || "").trim();
    if (!id) return { status: "error", message: "ID Order wajib ada" };

    const data = s.getDataRange().getValues();
    let row = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === id) {
        row = i + 1;
        break;
      }
    }

    if (row > 0) {
      s.deleteRow(row);
      return { status: "success", message: "Order berhasil dihapus" };
    }
    return { status: "error", message: "Order tidak ditemukan" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}
