class Product < ApplicationRecord
  def as_json(options = {})
    super.merge('price' => price.to_f)
  end
end
