class CreateCarts < ActiveRecord::Migration[7.2]
  def change
    create_table :carts do |t|
      t.string :session_token, null: false

      t.timestamps
    end

    add_index :carts, :session_token, unique: true
  end
end
