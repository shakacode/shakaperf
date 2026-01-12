class CartItem < ApplicationRecord
  belongs_to :cart
  belongs_to :product

  validates :quantity, presence: true, numericality: { greater_than: 0 }
  validates :product_id, uniqueness: { scope: :cart_id }
end
